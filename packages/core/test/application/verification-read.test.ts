import { setImmediate } from "node:timers/promises";
import { ok } from "@mete/contracts";
import { describe, expect, it, vi } from "vitest";
import { engineHarness, reply, slow } from "../helpers/engine.js";
import { verificationHarness } from "../helpers/verification.js";

describe("authoritative verification reads", () => {
	it("does not revive a finished pass while the selected attempt is being revised", async () => {
		const h = await verificationHarness(
			"[{ run: check }]",
			{
				scripts: [
					reply("first"),
					reply("second"),
					reply(JSON.stringify({ attempt: 1, reason: "first" })),
					slow,
				],
				tools: [
					[
						"shell.exec@1",
						async () =>
							ok({
								exitCode: 0,
								stdout: "",
								stderr: "",
								timedOut: false,
								os: "test",
								shell: "sh",
							}),
					],
				],
			},
			undefined,
			(source) =>
				source.replace(
					"title: Build,",
					"title: Build, approval: human, attempts: { n: 2, distinct_families: false, judge_tier: reasoning },",
				),
		);
		try {
			await vi.waitFor(() =>
				expect(h.engine.status(h.runId)).toMatchObject({
					value: [{ status: "paused", pauseReason: "approval" }],
				}),
			);
			const before = await h.read();
			if (!before.ok || !before.value.tasks[0]) throw new Error("missing task");
			const task = before.value.tasks[0];
			expect(task.evaluations).toHaveLength(2);
			expect(
				task.evaluations.map((evaluation) => evaluation.attemptNumber),
			).toEqual([1, 2]);
			const historical = task.evaluations.filter(
				(evaluation) => evaluation.attemptId !== task.currentAttemptId,
			);
			expect(
				await h.engine.approve(h.runId, {
					decision: "revise",
					feedback: "Revise the selected attempt.",
				}),
			).toEqual(ok(undefined));
			await vi.waitFor(() => expect(h.requests).toHaveLength(4));
			const during = await h.read();
			if (!during.ok) throw new Error("read failed");
			expect(during.value.tasks[0]?.currentAttemptId).toBe(
				task.currentAttemptId,
			);
			expect(during.value.tasks[0]?.evaluations).toEqual(historical);
			expect(historical).toHaveLength(1);
		} finally {
			await h.close();
		}
	});

	for (const action of ["recover", "cancel"] as const)
		it(`reads another engine's ${action} while its own gate outcome is pending`, async () => {
			let release = () => {};
			const waiting = new Promise<void>((resolve) => {
				release = resolve;
			});
			let calls = 0;
			const first = await verificationHarness("[{ run: check }]", {
				scripts: [reply("report")],
				tools: [
					[
						"shell.exec@1",
						async () => {
							calls++;
							await waiting;
							return ok({
								exitCode: 0,
								stdout: "",
								stderr: "",
								timedOut: false,
								os: "test",
								shell: "sh",
							});
						},
					],
				],
			});
			const other = engineHarness({ scripts: [], db: first.db });
			try {
				await vi.waitFor(() => expect(calls).toBe(1));
				expect(await first.read()).toMatchObject({
					value: {
						tasks: [{ evaluations: [{ gates: [{ status: "running" }] }] }],
					},
				});
				if (action === "recover") other.recover();
				else
					expect(await other.engine.cancel(first.runId)).toEqual(ok(undefined));
				const authoritative = await other.verification.read({
					runId: first.runId,
				});
				const events = first.events.length;
				const stored = other.store.load(first.runId)?.snapshot.context;
				expect(await first.read()).toEqual(authoritative);
				expect(await first.read()).toMatchObject({
					value: {
						tasks: [
							{
								evaluations: [
									{
										gates: [
											{
												status: "not_run",
												reason: "interrupted",
											},
										],
									},
								],
							},
						],
					},
				});
				expect(first.events).toHaveLength(events);
				expect(first.requests).toHaveLength(1);
				expect(other.store.load(first.runId)?.snapshot.context).toEqual(stored);
			} finally {
				release();
				await setImmediate();
				await other.stop();
				await first.close();
			}
		});

	it("reports a store failure instead of serving cached evidence", async () => {
		let unreadable = false;
		const h = await verificationHarness(
			"[{ capability: gameengine.test@1, optional: true }]",
			{
				scripts: [reply("report")],
				wrapStore: (store) => ({
					...store,
					load(id) {
						if (unreadable) throw new Error("SECRET store error");
						return store.load(id);
					},
				}),
			},
		);
		try {
			await vi.waitFor(() =>
				expect(h.engine.status(h.runId)).toMatchObject({
					value: [{ status: "completed" }],
				}),
			);
			unreadable = true;
			const result = await h.read();
			expect(result).toMatchObject({ ok: false, error: { code: "failed" } });
			expect(JSON.stringify(result)).not.toContain("SECRET");
		} finally {
			unreadable = false;
			await h.close();
		}
	});

	it("reports removal rather than a held completed snapshot", async () => {
		const h = await verificationHarness(
			"[{ capability: gameengine.test@1, optional: true }]",
		);
		try {
			await vi.waitFor(() =>
				expect(h.engine.status(h.runId)).toMatchObject({
					value: [{ status: "completed" }],
				}),
			);
			h.store.remove(h.runId);
			expect(await h.read()).toMatchObject({
				ok: false,
				error: { code: "not_found" },
			});
		} finally {
			await h.close();
		}
	});
});
