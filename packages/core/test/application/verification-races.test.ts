import { randomUUID } from "node:crypto";
import { setImmediate } from "node:timers/promises";
import { ok, type SecretsMaskAdapter } from "@mete/contracts";
import { describe, expect, it, vi } from "vitest";
import { runMachine } from "../../src/domain/run-machine.js";
import { withVerification } from "../../src/domain/verification.js";
import { engineHarness, reply } from "../helpers/engine.js";
import { verificationHarness } from "../helpers/verification.js";

const report = JSON.stringify({
	title: "Report",
	summary: "Summary",
	findings: [{ claim: "Claim", sourceIds: ["s1"] }],
	sources: [{ id: "s1", url: "https://example.test/", title: "Source" }],
});

describe("verification write ownership", () => {
	it("does not create an evaluation over a pause persisted while gate masking awaits", async () => {
		let release = () => {};
		const waiting = new Promise<void>((resolve) => {
			release = resolve;
		});
		let masking = false;
		let calls = 0;
		const h = await verificationHarness(
			"[{ run: MASK_GATE }]",
			{
				scripts: [reply("report")],
				tools: [
					[
						"shell.exec@1",
						async () => {
							calls++;
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
			},
			(opened) => {
				opened.registry.provide<SecretsMaskAdapter>("secrets.mask@1", {
					id: "mask",
					trust: "core",
					features: [],
					impl: {
						mask: async (text) => {
							if (text === "MASK_GATE") {
								masking = true;
								await waiting;
							}
							return { text, masked: 0 };
						},
					},
				});
			},
		);
		const other = engineHarness({ scripts: [], db: h.db });
		try {
			await vi.waitFor(() => expect(masking).toBe(true));
			expect(await other.engine.pause(h.runId)).toEqual(ok(undefined));
			const paused = other.store.load(h.runId)?.snapshot.context;
			release();
			// Drain the released masking continuation before inspecting or stopping A.
			await setImmediate();
			expect(calls).toBe(0);
			expect(h.store.load(h.runId)?.snapshot.value).toBe("paused");
			expect(h.store.load(h.runId)?.snapshot.context).toEqual(paused);
			expect(
				h.events.filter((event) => event.type.startsWith("verify.")),
			).toEqual([]);
		} finally {
			release();
			await other.stop();
			await h.close();
		}
	});

	it("does not select or block newer evidence written after recording the last attempt", async () => {
		let replaced = false;
		const evaluationId = randomUUID();
		const h = await verificationHarness(
			"[{ run: check }]",
			{
				scripts: [reply("notes"), reply(report)],
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
				wrapStore: (store) => ({
					...store,
					save(meta, snapshot) {
						store.save(meta, snapshot);
						const team = snapshot.context.team;
						const entry = team?.tasks.build;
						if (
							replaced ||
							!team ||
							!entry?.verification ||
							entry.attempts?.finished.length !== 2
						)
							return;
						replaced = true;
						store.save(
							meta,
							runMachine.resolveState({
								value: snapshot.value,
								context: {
									...snapshot.context,
									team: withVerification(team, "build", {
										...entry.verification,
										evaluationId,
										gates: [
											{
												index: 0,
												gate: "check",
												optional: false,
												status: "failed",
												details: "new evidence",
											},
										],
									}),
								},
							}),
						);
					},
				}),
			},
			undefined,
			(source) =>
				source.replace(
					"title: Build,",
					"title: Build, guardrail: { schema: research-report@1, max_retries: 0 }, attempts: { n: 2, distinct_families: false, judge_tier: reasoning },",
				),
		);
		try {
			await vi.waitFor(() => expect(replaced).toBe(true));
			await setImmediate();
			const entry = h.store.load(h.runId)?.snapshot.context.team?.tasks.build;
			expect(entry?.verification?.evaluationId).toBe(evaluationId);
			expect(entry?.status).toBe("in_progress");
			expect(entry?.attempts?.goesOn).toBeUndefined();
			expect(
				h.events.some(
					(event) =>
						event.type === "task.attempt.chosen" ||
						(event.type === "task.status.changed" &&
							["blocked", "submitted"].includes(event.payload.to)),
				),
			).toBe(false);
		} finally {
			await h.close();
		}
	});
});
