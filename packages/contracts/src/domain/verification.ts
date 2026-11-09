import { z } from "zod";
import type { EngineError } from "./engine.js";
import { IdSchema, TimestampSchema } from "./ids.js";
import type { Result } from "./result.js";

const position = z.number().int().nonnegative();
const gate = {
	index: position,
	gate: z.string().min(1),
	optional: z.boolean(),
	details: z.string(),
};

/** Why no executable success/failure was established for a gate (ADR-187). */
export const VerificationNotRunReasonSchema = z.enum([
	"not_reached",
	"capability_missing",
	"approval_required",
	"denied",
	"unsupported_expect",
	"interrupted",
]);

/** One gate's current evidence; absence of execution is never a successful check. */
export const VerificationGateSchema = z.discriminatedUnion("status", [
	z.strictObject({ ...gate, status: z.literal("running") }),
	z.strictObject({ ...gate, status: z.literal("passed") }),
	z.strictObject({ ...gate, status: z.literal("failed") }),
	z.strictObject({
		...gate,
		status: z.literal("not_run"),
		reason: VerificationNotRunReasonSchema,
	}),
]);
/** The validated state of one ordered gate. */
export type VerificationGate = z.infer<typeof VerificationGateSchema>;

/** The current evaluation for one exact attempt and masked submitted report. */
export const VerificationEvaluationSchema = z.strictObject({
	evaluationId: IdSchema,
	attemptId: IdSchema,
	attemptNumber: z.number().int().positive(),
	reportSha256: z.string().regex(/^[a-f0-9]{64}$/),
	startedAt: TimestampSchema,
	gates: z
		.array(VerificationGateSchema)
		.refine(
			(rows) => rows.every((row, index) => row.index === index),
			"gate positions must be contiguous and ordered",
		),
});
/** A report-bound evaluation for one attempt. */
export type VerificationEvaluation = z.infer<
	typeof VerificationEvaluationSchema
>;

/** A persisted update notification; consumers re-read authoritative evidence. */
export const VerificationUpdatedSchema = z.strictObject({
	evaluationId: IdSchema,
	attemptId: IdSchema,
	index: position,
});

/** A final gate result for the audit trail; never a running-state success claim. */
export const VerificationEvaluatedSchema = VerificationUpdatedSchema.extend({
	attemptNumber: z.number().int().positive(),
	result: VerificationGateSchema,
}).refine(
	(value) =>
		value.result.status !== "running" && value.index === value.result.index,
	"final evidence must identify the same completed gate position",
);

const task = z.strictObject({
	taskId: IdSchema,
	templateTaskId: z.string().min(1),
	title: z.string().min(1),
	currentAttemptId: IdSchema,
	evaluations: z
		.array(VerificationEvaluationSchema)
		.refine(
			(rows) =>
				new Set(rows.map((row) => row.attemptId)).size === rows.length &&
				new Set(rows.map((row) => row.evaluationId)).size === rows.length,
			"each attempt has one current evaluation",
		),
});

/** task.verification@1 read input; no mutation or model call is requested. */
export const TaskVerificationInputSchema = z.strictObject({ runId: IdSchema });
/** The run whose evidence is requested. */
export type TaskVerificationInput = z.infer<typeof TaskVerificationInputSchema>;

/** Persisted verification for a run; legacy results are not synthesized. */
export const TaskVerificationResultSchema = z
	.strictObject({
		mode: z.enum(["legacy", "strict"]),
		tasks: z
			.array(task)
			.refine(
				(rows) => new Set(rows.map((row) => row.taskId)).size === rows.length,
				"task identities must be unique",
			),
	})
	.refine(
		(value) =>
			value.mode !== "legacy" ||
			value.tasks.every((row) => row.evaluations.length === 0),
		"legacy results cannot contain strict verification evidence",
	);
/** Authoritative current evidence for a team's tasks. */
export type TaskVerificationResult = z.infer<
	typeof TaskVerificationResultSchema
>;

/** task.verification@1: read the current evidence, independently of event retention. */
export interface TaskVerificationAdapter {
	read(
		input: TaskVerificationInput,
	): Promise<Result<TaskVerificationResult, EngineError>>;
}
