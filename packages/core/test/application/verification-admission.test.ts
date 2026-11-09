import { randomUUID } from "node:crypto";
import { setImmediate } from "node:timers/promises";
import { ok } from "@mete/contracts";
import { describe, expect, it, vi } from "vitest";
import { runMachine } from "../../src/domain/run-machine.js";
import { withVerification } from "../../src/domain/verification.js";
import { engineHarness, reply } from "../helpers/engine.js";
import { verificationHarness } from "../helpers/verification.js";

const artifactTemplate = (source: string) =>
	source.replace(
		"title: Build, verify:",
		"title: Build, expected_output: artifact:code-change@1, verify:",
	);

describe("strict artifact admission", () => {
	it.each([1, 2])(
		"checks authoritative eligibility before recording %s attempts or writing an artifact",
		async (attempts) => {
			let writes = 0;
			const evaluationId = randomUUID();
			const h = await verificationHarness(
				"[{ run: check }]",
				{
					scripts: [reply("report")],
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
					artifacts: {
						write: async () => {
							writes++;
							return ok({ path: "artifact.md", sha256: "a".repeat(64) });
						},
					},
				},
				(opened) => {
					opened.bus.subscribe("verify.evaluated", (event) => {
						const stored = event.runId
							? opened.store.load(event.runId)
							: undefined;
						const team = stored?.snapshot.context.team;
						const evaluation = team?.tasks.build?.verification;
						if (!stored || !team || !evaluation)
							throw new Error("missing evidence");
						opened.store.save(
							stored.meta,
							runMachine.resolveState({
								value: stored.snapshot.value,
								context: {
									...stored.snapshot.context,
									team: withVerification(team, "build", {
										...evaluation,
										evaluationId,
										gates: [
											{
												index: 0,
												gate: "check",
												optional: false,
												status: "failed",
												details: "new failure",
											},
										],
									}),
								},
							}),
						);
					});
				},
				(source) => {
					const template = artifactTemplate(source);
					return attempts === 1
						? template
						: template.replace(
								"title: Build,",
								"title: Build, attempts: { n: 2, distinct_families: false, judge_tier: reasoning },",
							);
				},
			);
			try {
				await vi.waitFor(async () =>
					expect(await h.read()).toMatchObject({
						value: { tasks: [{ evaluations: [{ evaluationId }] }] },
					}),
				);
				await setImmediate();
				expect(writes).toBe(0);
				expect(h.requests).toHaveLength(1);
				expect(
					h.store.load(h.runId)?.snapshot.context.team?.tasks.build?.attempts
						?.finished ?? [],
				).toEqual([]);
				expect(
					h.events.some((event) => event.type === "task.attempt.chosen"),
				).toBe(false);
				expect(
					h.events.filter((event) => event.type.startsWith("artifact.")),
				).toEqual([]);
			} finally {
				await h.close();
			}
		},
	);
	it("does not write artifacts for a report with a required missing gate", async () => {
		let writes = 0;
		const h = await verificationHarness(
			"[{ capability: gameengine.test@1 }]",
			{
				scripts: [reply("report")],
				artifacts: {
					write: async () => {
						writes++;
						return ok({ path: "artifact.md", sha256: "a".repeat(64) });
					},
				},
			},
			undefined,
			artifactTemplate,
		);
		try {
			await vi.waitFor(() =>
				expect(h.engine.status(h.runId)).toMatchObject({
					value: [{ status: "paused" }],
				}),
			);
			expect(writes).toBe(0);
			expect(h.events.filter((e) => e.type.startsWith("artifact."))).toEqual(
				[],
			);
		} finally {
			await h.close();
		}
	});
	for (const action of ["pause", "cancel"] as const)
		it(`does not submit or announce an artifact that finished after ${action}`, async () => {
			let release = () => {};
			let writes = 0;
			const wait = new Promise<void>((resolve) => {
				release = resolve;
			});
			const h = await verificationHarness(
				"[{ run: check }]",
				{
					scripts: [reply("report")],
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
					artifacts: {
						write: async () => {
							writes++;
							await wait;
							return ok({ path: "artifact.md", sha256: "a".repeat(64) });
						},
					},
				},
				undefined,
				artifactTemplate,
			);
			try {
				await vi.waitFor(() => expect(writes).toBe(1));
				await h.engine[action](h.runId);
				release();
				await h.stop();
				expect(h.events.filter((e) => e.type.startsWith("artifact."))).toEqual(
					[],
				);
				expect(
					h.events.some(
						(e) =>
							e.type === "task.status.changed" && e.payload.to === "submitted",
					),
				).toBe(false);
				expect(h.engine.status(h.runId)).toMatchObject({
					value: [{ status: action === "pause" ? "paused" : "cancelled" }],
				});
				expect(await h.read()).toMatchObject({
					value: {
						tasks: [{ evaluations: [{ gates: [{ status: "passed" }] }] }],
					},
				});
			} finally {
				release();
				await h.close();
			}
		});
	it("cannot overwrite cancellation persisted by another engine while the artifact write awaits", async () => {
		let release = () => {};
		let writing = false;
		const wait = new Promise<void>((resolve) => {
			release = resolve;
		});
		const h = await verificationHarness(
			"[{ run: check }]",
			{
				scripts: [reply("report")],
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
				artifacts: {
					write: async () => {
						writing = true;
						await wait;
						return ok({ path: "artifact.md", sha256: "a".repeat(64) });
					},
				},
			},
			undefined,
			artifactTemplate,
		);
		const other = engineHarness({ scripts: [], db: h.db });
		try {
			await vi.waitFor(() => expect(writing).toBe(true));
			expect(await other.engine.cancel(h.runId)).toEqual(ok(undefined));
			const terminal = other.store.load(h.runId)?.snapshot.context.endedAt;
			release();
			await h.stop();
			expect(h.engine.status(h.runId)).toMatchObject({
				value: [{ status: "cancelled" }],
			});
			expect(h.store.load(h.runId)?.snapshot.context.endedAt).toBe(terminal);
			expect(
				h.events.filter((event) => event.type.startsWith("artifact.")),
			).toEqual([]);
			expect(
				h.events.some(
					(event) =>
						event.type === "task.status.changed" &&
						event.payload.to === "submitted",
				),
			).toBe(false);
		} finally {
			release();
			await other.stop();
			await h.close();
		}
	});
	it.each([false, true])(
		"cannot submit or fail replaced evidence after a late artifact (failure=%s)",
		async (failed) => {
			let release = () => {};
			let writing = false;
			const wait = new Promise<void>((resolve) => {
				release = resolve;
			});
			const h = await verificationHarness(
				"[{ run: check }]",
				{
					scripts: [reply("report")],
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
					artifacts: {
						write: async () => {
							writing = true;
							await wait;
							if (failed)
								return {
									ok: false,
									error: { code: "io", message: "old write failed" },
								};
							return ok({ path: "artifact.md", sha256: "a".repeat(64) });
						},
					},
				},
				undefined,
				artifactTemplate,
			);
			try {
				await vi.waitFor(() => expect(writing).toBe(true));
				const stored = h.store.load(h.runId);
				const team = stored?.snapshot.context.team;
				const evaluation = team?.tasks.build?.verification;
				if (!stored || !team || !evaluation)
					throw new Error("missing evidence");
				const evaluationId = randomUUID();
				const current = withVerification(team, "build", {
					...evaluation,
					evaluationId,
					gates: [
						{
							index: 0,
							gate: "check",
							optional: false,
							status: "failed",
							details: "new failure",
						},
					],
				});
				h.store.save(
					stored.meta,
					runMachine.resolveState({
						value: stored.snapshot.value,
						context: { ...stored.snapshot.context, team: current },
					}),
				);
				release();
				await vi.waitFor(async () =>
					expect(await h.read()).toMatchObject({
						value: { tasks: [{ evaluations: [{ evaluationId }] }] },
					}),
				);
				await setImmediate();
				expect(
					h.events.filter((event) => event.type.startsWith("artifact.")),
				).toEqual([]);
				expect(
					h.events.some(
						(event) =>
							event.type === "task.status.changed" &&
							event.payload.to === "submitted",
					),
				).toBe(false);
				expect(
					h.store.load(h.runId)?.snapshot.context.team?.tasks.build
						?.verification?.evaluationId,
				).toBe(evaluationId);
				expect(h.engine.status(h.runId)).toMatchObject({
					value: [{ status: "running" }],
				});
			} finally {
				release();
				await h.close();
			}
		},
	);
});
