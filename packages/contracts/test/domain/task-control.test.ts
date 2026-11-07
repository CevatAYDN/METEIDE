import { describe, expect, expectTypeOf, it } from "vitest";
import type { EngineError } from "../../src/domain/engine.js";
import type { Result } from "../../src/domain/result.js";
import {
	type TaskControlAdapter,
	TaskControlAnswerSchema,
	type TaskPending,
	TaskPendingInputSchema,
	TaskPendingResultSchema,
	TaskPendingSchema,
} from "../../src/domain/task-control.js";

const runId = "7f3c2a1e-4b5d-4c6e-8f9a-0b1c2d3e4f5a";
const taskId = "8f3c2a1e-4b5d-4c6e-8f9a-0b1c2d3e4f5a";
const requestId = "9f3c2a1e-4b5d-4c6e-8f9a-0b1c2d3e4f5a";
const identity = { runId, taskId, requestId };
const common = {
	...identity,
	templateTaskId: "write_code",
	title: "Write code",
};
const ask = {
	action: "fs.write",
	capability: "fs.write@1",
	adapterId: "test-adapter",
	path: "src/file.ts",
} as const;
const waits = [
	{ ...common, kind: "policy", ask, rule: "autonomy" },
	{ ...common, kind: "approval" },
	{ ...common, kind: "clarification", question: "Which format?" },
	{ ...common, kind: "blocked", reason: "guardrail" },
	{ ...common, kind: "merge", message: "Conflict" },
];
const answers = [
	{ ...identity, decision: "allow", scope: "once" },
	{ ...identity, decision: "allow", scope: "task" },
	{ ...identity, decision: "approve" },
	{ ...identity, decision: "revise", feedback: "Add evidence" },
	{ ...identity, decision: "answer", feedback: "Use JSON" },
	{ ...identity, decision: "retry" },
];

describe("task.control@1 pending", () => {
	it("accepts every wait kind and optional display data without changing identity", () => {
		for (const wait of waits) {
			expect(TaskPendingSchema.parse(wait)).toEqual(wait);
			const display = {
				...wait,
				agentId: taskId,
				worktree: "worktree",
				branch: "branch",
			};
			expect(TaskPendingSchema.parse(display)).toEqual(display);
		}
		for (const wait of [
			{ ...common, kind: "approval", report: "" },
			{ ...common, kind: "approval", report: "Review this" },
			{ ...common, kind: "merge", message: "", paths: [] },
			{ ...common, kind: "merge", message: "Conflict", paths: ["src/file.ts"] },
		])
			expect(TaskPendingSchema.parse(wait)).toEqual(wait);
		expect(TaskPendingInputSchema.parse({ runId })).toEqual({ runId });
		for (const requests of [[], waits])
			expect(TaskPendingResultSchema.parse({ requests })).toEqual({
				requests,
			});
	});

	it.each(waits)(
		"rejects invalid identities and extra fields on $kind",
		(wait) => {
			for (const key of ["runId", "taskId", "requestId"])
				for (const value of ["bad", undefined])
					expect(
						TaskPendingSchema.safeParse({ ...wait, [key]: value }).success,
					).toBe(false);
			for (const fields of [
				{ agentId: "bad" },
				{ templateTaskId: "" },
				{ title: "" },
				{ extra: true },
			])
				expect(
					TaskPendingSchema.safeParse({ ...wait, ...fields }).success,
				).toBe(false);
		},
	);

	it("rejects malformed pending inputs and results", () => {
		for (const input of [{}, { runId: "bad" }, { runId, taskId }])
			expect(TaskPendingInputSchema.safeParse(input).success).toBe(false);
		expect(
			TaskPendingResultSchema.safeParse({ requests: waits, extra: true })
				.success,
		).toBe(false);
		expect(
			TaskPendingResultSchema.safeParse({ requests: [{ ...common }] }).success,
		).toBe(false);
	});

	it("rejects unknown kinds, missing details and fields from another kind", () => {
		for (const detail of [
			{},
			{ kind: "unknown" },
			{ kind: "policy", ask },
			{ kind: "policy", ask, rule: "" },
			{ kind: "policy", rule: "autonomy" },
			{ kind: "policy", ask: { ...ask, args: {} }, rule: "autonomy" },
			{ kind: "approval", report: 1 },
			{ kind: "approval", question: "Wrong kind" },
			{ kind: "clarification" },
			{ kind: "clarification", question: "" },
			{ kind: "blocked" },
			{ kind: "blocked", reason: "" },
			{ kind: "merge" },
			{ kind: "merge", message: "Conflict", paths: [1] },
		])
			expect(
				TaskPendingSchema.safeParse({ ...common, ...detail }).success,
			).toBe(false);
	});
});

describe("task.control@1 answers", () => {
	it("accepts only the documented decisions with their exact request identity", () => {
		for (const answer of answers)
			expect(TaskControlAnswerSchema.parse(answer)).toEqual(answer);
	});

	it.each(answers)(
		"rejects invalid identities and replacement actions on $decision",
		(answer) => {
			for (const key of ["runId", "taskId", "requestId"])
				for (const value of ["bad", undefined])
					expect(
						TaskControlAnswerSchema.safeParse({ ...answer, [key]: value })
							.success,
					).toBe(false);
			for (const fields of [
				{ command: "replacement" },
				{ path: "replacement" },
				{ ask },
				{ extra: true },
			])
				expect(
					TaskControlAnswerSchema.safeParse({ ...answer, ...fields }).success,
				).toBe(false);
		},
	);

	it("requires feedback for revise and answer, and only once or task for allow", () => {
		for (const decision of ["revise", "answer"])
			for (const feedback of [undefined, "", " "])
				expect(
					TaskControlAnswerSchema.safeParse({ ...identity, decision, feedback })
						.success,
				).toBe(false);
		for (const detail of [
			{},
			{ decision: "unknown" },
			{ decision: "allow" },
			{ decision: "allow", scope: "run" },
			{ decision: "allow", scope: "always" },
			{ decision: "approve", feedback: "Wrong decision" },
			{ decision: "retry", scope: "once" },
		])
			expect(
				TaskControlAnswerSchema.safeParse({ ...identity, ...detail }).success,
			).toBe(false);
	});

	it("returns asynchronous Results using the existing engine errors", () => {
		expectTypeOf<ReturnType<TaskControlAdapter["pending"]>>().toEqualTypeOf<
			Promise<Result<{ requests: TaskPending[] }, EngineError>>
		>();
		expectTypeOf<ReturnType<TaskControlAdapter["answer"]>>().toEqualTypeOf<
			Promise<Result<void, EngineError>>
		>();
	});
});
