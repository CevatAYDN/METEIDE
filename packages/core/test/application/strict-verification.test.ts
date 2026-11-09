import { ok, type SecretsMaskAdapter } from "@mete/contracts";
import { describe, expect, it, vi } from "vitest";
import { reportSha256 } from "../../src/domain/verification.js";
import { reply, slow, type Tool } from "../helpers/engine.js";
import { policyRequestsFixture } from "../helpers/policy-requests.js";
import { verificationHarness } from "../helpers/verification.js";

const settled = async (
	h: Awaited<ReturnType<typeof verificationHarness>>,
	status: string,
) =>
	vi.waitFor(() =>
		expect(h.engine.status(h.runId)).toMatchObject({ value: [{ status }] }),
	);

describe("strict verification gates", () => {
	it("completes a new v1-template task with no gates without downgrading its mode", async () => {
		const h = await verificationHarness("[]", undefined, undefined, (source) =>
			source.replace("mete/v2", "mete/v1"),
		);
		try {
			await settled(h, "completed");
			expect(await h.read()).toMatchObject({
				value: { mode: "strict", tasks: [{ evaluations: [{ gates: [] }] }] },
			});
		} finally {
			await h.close();
		}
	});
	it("blocks a denied gate when optional is explicitly false", async () => {
		const h = await verificationHarness("[{ run: check, optional: false }]", {
			scripts: [reply("report")],
			tools: [
				[
					"shell.exec@1",
					async () => ({
						ok: false,
						error: { code: "denied", message: "refused" },
					}),
				],
			],
		});
		try {
			await settled(h, "paused");
			expect(await h.read()).toMatchObject({
				value: {
					tasks: [
						{
							evaluations: [
								{
									gates: [
										{ status: "not_run", reason: "denied", optional: false },
									],
								},
							],
						},
					],
				},
			});
		} finally {
			await h.close();
		}
	});
	it("blocks required absence and keeps later rows explicitly not reached", async () => {
		const h = await verificationHarness(
			"[{ capability: gameengine.test@1 }, { run: later }]",
		);
		try {
			await settled(h, "paused");
			expect(await h.read()).toMatchObject({
				value: {
					mode: "strict",
					tasks: [
						{
							evaluations: [
								{
									gates: [
										{
											index: 0,
											status: "not_run",
											reason: "capability_missing",
											optional: false,
										},
										{ index: 1, status: "not_run", reason: "not_reached" },
									],
								},
							],
						},
					],
				},
			});
			expect(
				h.events.some(
					(e) =>
						e.type === "task.status.changed" && e.payload.to === "submitted",
				),
			).toBe(false);
			expect(
				await h.engine.approve(h.runId, {
					taskId: "build",
					decision: "approve",
				}),
			).toMatchObject({ ok: false });
		} finally {
			await h.close();
		}
	});
	it("allows explicit optional missing/denied/expect gaps but does not invoke expect", async () => {
		let calls = 0;
		const tool: Tool = async () => {
			calls++;
			return { ok: false, error: { code: "denied", message: "refused" } };
		};
		const h = await verificationHarness(
			"[{ capability: gameengine.test@1, optional: true }, { capability: gameengine.build@1, optional: true }, { capability: gameengine.build@1, expect: null, optional: true }]",
			{ scripts: [reply("report")], tools: [["gameengine.build@1", tool]] },
		);
		try {
			await settled(h, "completed");
			expect(calls).toBe(1);
			expect(await h.read()).toMatchObject({
				value: {
					tasks: [
						{
							evaluations: [
								{
									gates: [
										{ index: 0, reason: "capability_missing" },
										{ index: 1, reason: "denied" },
										{ index: 2, reason: "unsupported_expect" },
									],
								},
							],
						},
					],
				},
			});
		} finally {
			await h.close();
		}
	});
	it("keeps an optional actual failure failed and requires another report cycle", async () => {
		const h = await verificationHarness(
			"[{ run: check, optional: true }]",
			{
				scripts: [reply("report"), slow],
				tools: [
					[
						"shell.exec@1",
						async () =>
							ok({
								exitCode: 1,
								stdout: "SECRET broken",
								stderr: "",
								timedOut: false,
								os: "test",
								shell: "sh",
							}),
					],
				],
			},
			({ registry }) => {
				registry.provide<SecretsMaskAdapter>("secrets.mask@1", {
					id: "mask",
					trust: "core",
					features: [],
					impl: {
						mask: async (text) => ({
							text: text.replaceAll("SECRET", "[MASKED]"),
							masked: 1,
						}),
					},
				});
			},
		);
		try {
			await vi.waitFor(() => expect(h.requests.length).toBe(2));
			expect(await h.read()).toMatchObject({
				value: {
					tasks: [
						{
							evaluations: [{ gates: [{ status: "failed", optional: true }] }],
						},
					],
				},
			});
			expect(JSON.stringify(await h.read())).not.toContain("SECRET");
			expect(
				h.events.some(
					(e) =>
						e.type === "task.status.changed" && e.payload.to === "submitted",
				),
			).toBe(false);
		} finally {
			await h.close();
		}
	});
	it("blocks an explicitly optional interrupted command until human inspection", async () => {
		const h = await verificationHarness("[{ run: check, optional: true }]", {
			scripts: [reply("report")],
			tools: [
				[
					"shell.exec@1",
					async () =>
						ok({
							exitCode: null,
							stdout: "",
							stderr: "",
							timedOut: false,
							os: "test",
							shell: "sh",
						}),
				],
			],
		});
		try {
			await settled(h, "paused");
			expect(await h.read()).toMatchObject({
				value: {
					tasks: [
						{
							evaluations: [
								{
									gates: [
										{
											status: "not_run",
											reason: "interrupted",
											optional: true,
										},
									],
								},
							],
						},
					],
				},
			});
			expect(
				await h.engine.approve(h.runId, { decision: "approve" }),
			).toMatchObject({ ok: false });
		} finally {
			await h.close();
		}
	});
	it("records a throwing optional adapter as failure without leaking its error", async () => {
		const h = await verificationHarness("[{ run: check, optional: true }]", {
			scripts: [reply("report"), slow],
			tools: [
				[
					"shell.exec@1",
					async () => {
						throw new Error("SECRET");
					},
				],
			],
		});
		try {
			await vi.waitFor(() => expect(h.requests).toHaveLength(2));
			expect(await h.read()).toMatchObject({
				value: {
					tasks: [{ evaluations: [{ gates: [{ status: "failed" }] }] }],
				},
			});
			expect(JSON.stringify(await h.read())).not.toContain("SECRET");
		} finally {
			await h.close();
		}
	});
	it("creates new evidence for an identical reply after repair instead of reusing its old pass", async () => {
		let calls = 0;
		const evaluations: string[] = [];
		const h = await verificationHarness(
			"[{ run: check }]",
			{
				// The first gate passes, but its report fails the guardrail; the identical next reply is new work.
				scripts: [reply("same"), reply("same"), slow],
				tools: [
					[
						"shell.exec@1",
						async () => {
							calls++;
							return ok({
								exitCode: calls === 1 ? 0 : 1,
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
			({ bus }) => {
				bus.subscribe("verify.evaluated", (event) =>
					evaluations.push(event.payload.evaluationId),
				);
			},
			(source) =>
				source.replace(
					"title: Build, verify:",
					"title: Build, guardrail: { schema: research-report@1, max_retries: 1 }, verify:",
				),
		);
		try {
			await vi.waitFor(() => expect(h.requests).toHaveLength(3));
			expect(calls).toBe(2);
			expect(new Set(evaluations).size).toBe(2);
			expect(await h.read()).toMatchObject({
				value: {
					tasks: [{ evaluations: [{ gates: [{ status: "failed" }] }] }],
				},
			});
		} finally {
			await h.close();
		}
	});
	it("marks present required expect unsupported before adapter dispatch", async () => {
		let calls = 0;
		const h = await verificationHarness(
			"[{ capability: gameengine.build@1, expect: false }]",
			{
				scripts: [reply("report")],
				tools: [
					[
						"gameengine.build@1",
						async () => {
							calls++;
							return ok({ log: "built" });
						},
					],
				],
			},
		);
		try {
			await settled(h, "paused");
			expect(calls).toBe(0);
			expect(await h.read()).toMatchObject({
				value: {
					tasks: [
						{ evaluations: [{ gates: [{ reason: "unsupported_expect" }] }] },
					],
				},
			});
		} finally {
			await h.close();
		}
	});
	it("records invalid mapped output as failed even when explicitly optional", async () => {
		const h = await verificationHarness(
			"[{ capability: gameengine.build@1, optional: true }]",
			{
				scripts: [reply("report"), slow],
				tools: [["gameengine.build@1", async () => ok({ wrong: true })]],
			},
		);
		try {
			await vi.waitFor(() => expect(h.requests.length).toBe(2));
			expect(await h.read()).toMatchObject({
				value: {
					tasks: [{ evaluations: [{ gates: [{ status: "failed" }] }] }],
				},
			});
		} finally {
			await h.close();
		}
	});
	it("preserves an optional gate's exact policy wait and permits only its exact allow", async () => {
		const fixture = policyRequestsFixture();
		let completed = 0;
		const h = await verificationHarness(
			'[{ run: first }, { capability: web.fetch@1, args: { url: "https://example.test/" }, optional: true }]',
			{
				scripts: [reply("report")],
				tools: [
					["web.fetch@1", fixture.run],
					[
						"shell.exec@1",
						async () => {
							completed++;
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
			({ registry }) => {
				registry.provide("policy.requests@1", {
					id: "security",
					trust: "core",
					features: [],
					impl: fixture.port,
				});
			},
		);
		try {
			await settled(h, "paused");
			const pending = await h.tasks.pending({ runId: h.runId });
			const request = pending.ok ? pending.value.requests[0] : undefined;
			if (!request) throw new Error("policy wait missing");
			expect(request.kind).toBe("policy");
			const before = await h.read();
			expect(before).toMatchObject({
				value: {
					tasks: [
						{
							evaluations: [
								{
									gates: [
										{ status: "passed" },
										{ status: "not_run", reason: "approval_required" },
									],
								},
							],
						},
					],
				},
			});
			const identity = {
				runId: h.runId,
				taskId: request.taskId,
				requestId: request.requestId,
			};
			expect(
				await h.tasks.answer({ ...identity, decision: "approve" }),
			).toMatchObject({ ok: false });
			expect(
				await h.tasks.answer({ ...identity, decision: "allow", scope: "once" }),
			).toEqual(ok(undefined));
			await settled(h, "completed");
			expect(fixture.calls).toHaveLength(2);
			expect(completed).toBe(1);
			const after = await h.read();
			if (!before.ok || !after.ok) throw new Error("read failed");
			expect(after.value.tasks[0]?.evaluations[0]?.evaluationId).toBe(
				before.value.tasks[0]?.evaluations[0]?.evaluationId,
			);
			expect(
				await h.tasks.answer({ ...identity, decision: "allow", scope: "once" }),
			).toMatchObject({ ok: false });
		} finally {
			await h.close();
		}
	});
	it("persists duplicate gate indexes and masked details before notifications", async () => {
		const persisted: unknown[] = [];
		const h = await verificationHarness(
			"[{ run: SECRET }, { run: SECRET }]",
			{
				scripts: [reply("SECRET report")],
				tools: [
					[
						"shell.exec@1",
						async () =>
							ok({
								exitCode: 0,
								stdout: "SECRET",
								stderr: "",
								timedOut: false,
								os: "test",
								shell: "sh",
							}),
					],
				],
			},
			(h) => {
				h.registry.provide<SecretsMaskAdapter>("secrets.mask@1", {
					id: "mask",
					trust: "core",
					features: [],
					impl: {
						mask: async (text) => ({
							text: text.replaceAll("SECRET", "[MASKED]"),
							masked: 1,
						}),
					},
				});
				h.bus.subscribe("verify.evaluated", (event) => {
					const entry = event.runId
						? h.store.load(event.runId)?.snapshot.context.team?.tasks.build
						: undefined;
					persisted.push(entry?.verification?.gates[event.payload.index]);
				});
			},
		);
		try {
			await settled(h, "completed");
			expect(persisted).toEqual([
				{
					index: 0,
					gate: "[MASKED]",
					optional: false,
					status: "passed",
					details: expect.stringContaining("[MASKED]"),
				},
				{
					index: 1,
					gate: "[MASKED]",
					optional: false,
					status: "passed",
					details: expect.stringContaining("[MASKED]"),
				},
			]);
			expect(JSON.stringify(await h.read())).not.toContain("SECRET");
			expect(await h.read()).toMatchObject({
				value: {
					tasks: [{ evaluations: [{ gates: [{ index: 0 }, { index: 1 }] }] }],
				},
			});
			expect(await h.read()).toMatchObject({
				value: {
					tasks: [
						{
							evaluations: [
								{
									reportSha256: reportSha256("[MASKED] report"),
								},
							],
						},
					],
				},
			});
		} finally {
			await h.close();
		}
	});
});
