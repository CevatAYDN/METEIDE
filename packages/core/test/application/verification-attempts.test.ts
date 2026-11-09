import { ok } from "@mete/contracts";
import { describe, expect, it, vi } from "vitest";
import { reply } from "../helpers/engine.js";
import { verificationHarness } from "../helpers/verification.js";

const report = JSON.stringify({
	title: "Report",
	summary: "Summary",
	findings: [{ claim: "Claim", sourceIds: ["s1"] }],
	sources: [{ id: "s1", url: "https://example.test/", title: "Source" }],
});
const best = (source: string) =>
	source.replace(
		"title: Build, verify:",
		"title: Build, guardrail: { schema: research-report@1, max_retries: 0 }, attempts: { n: 2, distinct_families: false, judge_tier: reasoning }, verify:",
	);
const settled = async (
	h: Awaited<ReturnType<typeof verificationHarness>>,
	status: string,
) =>
	vi.waitFor(() =>
		expect(h.engine.status(h.runId)).toMatchObject({ value: [{ status }] }),
	);

describe("strict verification attempt admission", () => {
	it("selects only the candidate whose own report and verification passed", async () => {
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
			},
			undefined,
			best,
		);
		try {
			await settled(h, "completed");
			expect(
				h.events
					.filter((event) => event.type === "task.attempt.chosen")
					.map((event) => event.payload),
			).toEqual([{ attempt: 2, of: 2, by: "checks" }]);
			const read = await h.read();
			if (!read.ok) throw new Error("read failed");
			const evaluations = read.value.tasks[0]?.evaluations ?? [];
			expect(evaluations.map((evaluation) => evaluation.attemptNumber)).toEqual(
				[1, 2],
			);
			expect(
				new Set(evaluations.map((evaluation) => evaluation.attemptId)).size,
			).toBe(2);
			expect(
				new Set(evaluations.map((evaluation) => evaluation.evaluationId)).size,
			).toBe(2);
		} finally {
			await h.close();
		}
	});
	it("does not borrow the earlier candidate's proof when the next identical report has a denied required gate", async () => {
		let calls = 0;
		const h = await verificationHarness(
			"[{ run: check }]",
			{
				scripts: [reply(report), reply(report)],
				tools: [
					[
						"shell.exec@1",
						async () =>
							++calls === 1
								? ok({
										exitCode: 0,
										stdout: "",
										stderr: "",
										timedOut: false,
										os: "test",
										shell: "sh",
									})
								: { ok: false, error: { code: "denied", message: "refused" } },
					],
				],
			},
			undefined,
			best,
		);
		try {
			await settled(h, "paused");
			expect(calls).toBe(2);
			expect(
				h.events.some((event) => event.type === "task.attempt.chosen"),
			).toBe(false);
			expect(
				h.events.some(
					(event) =>
						event.type === "task.status.changed" &&
						event.payload.to === "submitted",
				),
			).toBe(false);
			expect(await h.read()).toMatchObject({
				value: {
					tasks: [
						{
							evaluations: [
								{ attemptNumber: 1, gates: [{ status: "passed" }] },
								{
									attemptNumber: 2,
									gates: [{ status: "not_run", reason: "denied" }],
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
	it("invalidates a passed evaluation on human revision even when the reply bytes are identical", async () => {
		let calls = 0;
		const h = await verificationHarness(
			"[{ run: check }]",
			{
				scripts: [reply("same"), reply("same")],
				tools: [
					[
						"shell.exec@1",
						async () =>
							++calls === 1
								? ok({
										exitCode: 0,
										stdout: "",
										stderr: "",
										timedOut: false,
										os: "test",
										shell: "sh",
									})
								: { ok: false, error: { code: "denied", message: "refused" } },
					],
				],
			},
			undefined,
			(source) =>
				source.replace(
					"title: Build, verify:",
					"title: Build, approval: human, verify:",
				),
		);
		try {
			await settled(h, "paused");
			const before = await h.read();
			expect(
				await h.engine.approve(h.runId, {
					decision: "revise",
					feedback: "Check again.",
				}),
			).toEqual(ok(undefined));
			await vi.waitFor(() => expect(calls).toBe(2));
			await settled(h, "paused");
			const after = await h.read();
			if (!before.ok || !after.ok) throw new Error("read failed");
			const old = before.value.tasks[0]?.evaluations[0];
			const current = after.value.tasks[0]?.evaluations[0];
			expect(current?.attemptId).toBe(old?.attemptId);
			expect(current?.reportSha256).toBe(old?.reportSha256);
			expect(current?.evaluationId).not.toBe(old?.evaluationId);
			expect(current?.gates[0]).toMatchObject({
				status: "not_run",
				reason: "denied",
			});
			expect(
				await h.engine.approve(h.runId, { decision: "approve" }),
			).toMatchObject({ ok: false });
		} finally {
			await h.close();
		}
	});
});
