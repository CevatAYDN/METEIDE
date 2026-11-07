import { z } from "zod";
import type { EngineError } from "./engine.js";
import { IdSchema } from "./ids.js";
import { PolicyAskSchema } from "./policy.js";
import type { Result } from "./result.js";

const identity = {
	runId: IdSchema,
	taskId: IdSchema,
	requestId: IdSchema,
};
const pending = {
	...identity,
	templateTaskId: z.string().min(1),
	title: z.string().min(1),
	agentId: IdSchema.optional(),
	worktree: z.string().optional(),
	branch: z.string().optional(),
};

/** A task-local wait with an exact request identity and masked display data (ADR-181). */
export const TaskPendingSchema = z.discriminatedUnion("kind", [
	z.strictObject({
		...pending,
		kind: z.literal("policy"),
		ask: PolicyAskSchema,
		rule: z.string().min(1),
	}),
	z.strictObject({
		...pending,
		kind: z.literal("approval"),
		report: z.string().optional(),
	}),
	z.strictObject({
		...pending,
		kind: z.literal("clarification"),
		question: z.string().min(1),
	}),
	z.strictObject({
		...pending,
		kind: z.literal("blocked"),
		reason: z.string().min(1),
	}),
	z.strictObject({
		...pending,
		kind: z.literal("merge"),
		message: z.string(),
		paths: z.array(z.string()).optional(),
	}),
]);

/** One authoritative pending decision, not a target inferred from event order. */
export type TaskPending = z.infer<typeof TaskPendingSchema>;

/** task.control@1 pending: request the authoritative waits for one run. */
export const TaskPendingInputSchema = z.strictObject({
	runId: IdSchema,
});

/** The run whose pending task decisions are requested. */
export type TaskPendingInput = z.infer<typeof TaskPendingInputSchema>;

/** The pending task decisions returned by task.control@1. */
export const TaskPendingResultSchema = z.strictObject({
	requests: z.array(TaskPendingSchema),
});

/** A run's authoritative pending task decisions. */
export type TaskPendingResult = z.infer<typeof TaskPendingResultSchema>;

/** Answer only an exact task request; no replacement action arguments are accepted. */
export const TaskControlAnswerSchema = z.discriminatedUnion("decision", [
	z.strictObject({
		...identity,
		decision: z.literal("allow"),
		scope: z.enum(["once", "task"]),
	}),
	z.strictObject({ ...identity, decision: z.literal("approve") }),
	z.strictObject({
		...identity,
		decision: z.literal("revise"),
		feedback: z.string().trim().min(1),
	}),
	z.strictObject({
		...identity,
		decision: z.literal("answer"),
		feedback: z.string().trim().min(1),
	}),
	z.strictObject({ ...identity, decision: z.literal("retry") }),
]);

/** A human decision addressed to one run, task and immutable pending request. */
export type TaskControlAnswer = z.infer<typeof TaskControlAnswerSchema>;

/** task.control@1: list task-local waits and answer exact pending identities (ADR-181). */
export interface TaskControlAdapter {
	pending(
		input: TaskPendingInput,
	): Promise<Result<TaskPendingResult, EngineError>>;
	answer(input: TaskControlAnswer): Promise<Result<void, EngineError>>;
}
