import { describe, expect, it } from "vitest";
import { parseEvent } from "../../src/domain/events.js";
import {
	TaskVerificationInputSchema,
	TaskVerificationResultSchema,
	VerificationEvaluationSchema,
	VerificationGateSchema,
} from "../../src/domain/verification.js";

const id = "00000000-0000-4000-8000-000000000001";
const second = "00000000-0000-4000-8000-000000000002";
const gate = { index: 0, gate: "check", optional: false, details: "" };
const evaluation = {
	evaluationId: id,
	attemptId: second,
	attemptNumber: 1,
	reportSha256: "a".repeat(64),
	startedAt: "2026-11-08T00:00:00Z",
	gates: [{ ...gate, status: "passed" }],
};
const envelope = (type: string, payload: unknown) => ({
	id,
	type,
	schema: 1,
	workspaceId: id,
	runId: id,
	taskId: second,
	source: "core-engine",
	ts: evaluation.startedAt,
	payload,
});

describe("verification evidence contracts", () => {
	it("keeps running, pass, failure and not-run states distinct", () => {
		for (const state of [
			{ status: "running" },
			{ status: "passed" },
			{ status: "failed" },
			{ status: "not_run", reason: "capability_missing" },
		])
			expect(
				VerificationGateSchema.safeParse({ ...gate, ...state }).success,
			).toBe(true);
		for (const state of [
			{ status: "passed", reason: "capability_missing" },
			{ status: "not_run" },
			{ status: "not_run", reason: "invented" },
			{ status: "skipped" },
		])
			expect(
				VerificationGateSchema.safeParse({ ...gate, ...state }).success,
			).toBe(false);
	});

	it("keeps duplicate gate names separate by contiguous position", () => {
		const repeated = {
			...evaluation,
			gates: [
				{ ...gate, status: "passed" },
				{ ...gate, index: 1, status: "not_run", reason: "unsupported_expect" },
			],
		};
		expect(VerificationEvaluationSchema.safeParse(repeated).success).toBe(true);
		expect(
			VerificationEvaluationSchema.safeParse({
				...repeated,
				gates: [repeated.gates[0], repeated.gates[0]],
			}).success,
		).toBe(false);
		expect(
			VerificationEvaluationSchema.safeParse({
				...evaluation,
				reportSha256: "not-a-hash",
			}).success,
		).toBe(false);
	});

	it("validates authoritative task/attempt results without guessing legacy evidence", () => {
		const task = {
			taskId: id,
			templateTaskId: "work",
			title: "Work",
			currentAttemptId: second,
			evaluations: [evaluation],
		};
		expect(TaskVerificationInputSchema.safeParse({ runId: id }).success).toBe(
			true,
		);
		expect(
			TaskVerificationInputSchema.safeParse({ runId: id, taskId: second })
				.success,
		).toBe(false);
		expect(
			TaskVerificationResultSchema.safeParse({ mode: "strict", tasks: [task] })
				.success,
		).toBe(true);
		expect(
			TaskVerificationResultSchema.safeParse({
				mode: "legacy",
				tasks: [{ ...task, evaluations: [] }],
			}).success,
		).toBe(true);
		expect(
			TaskVerificationResultSchema.safeParse({ mode: "legacy", tasks: [task] })
				.success,
		).toBe(false);
		expect(
			TaskVerificationResultSchema.safeParse({
				mode: "strict",
				tasks: [task, task],
			}).success,
		).toBe(false);
		expect(
			TaskVerificationResultSchema.safeParse({
				mode: "strict",
				tasks: [{ ...task, evaluations: [evaluation, evaluation] }],
			}).success,
		).toBe(false);
	});

	it("adds wakeups and final evidence without changing legacy event payloads", () => {
		const identity = { evaluationId: id, attemptId: second, index: 0 };
		expect(parseEvent(envelope("verify.updated", identity)).ok).toBe(true);
		const result = { ...gate, status: "not_run", reason: "interrupted" };
		expect(
			parseEvent(
				envelope("verify.evaluated", { ...identity, attemptNumber: 1, result }),
			).ok,
		).toBe(true);
		expect(
			parseEvent(
				envelope("verify.evaluated", {
					...identity,
					attemptNumber: 1,
					result: { ...gate, status: "running" },
				}),
			).ok,
		).toBe(false);
		expect(
			parseEvent(
				envelope("verify.completed", { gate: "check", ok: true, details: "" }),
			).ok,
		).toBe(true);
	});
});
