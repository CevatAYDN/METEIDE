import { z } from "zod";
import { ApprovalInputSchema } from "./engine.js";
import { IdSchema, TimestampSchema } from "./ids.js";
import { PauseReasonSchema, RunStatusSchema } from "./states.js";

// Daemon protocol version 4 from ARCHITECTURE.md (Daemon protocol, ADR-045 to ADR-048).
// The notification `mete/event` carries a MeteEvent, so it is checked with MeteEventSchema (events.ts).

/** The messages of version 4; the params of mete/run.start are RunStartSchema (engine.ts). */
export const DAEMON_METHODS = {
	status: "mete/status",
	runStart: "mete/run.start",
	runApprove: "mete/run.approve",
	runResume: "mete/run.resume",
	event: "mete/event",
} as const;

/** JSON-RPC code of an error answer: the implementation-defined range; a client reads `data.code`. */
export const DAEMON_ERROR_CODE = -32000;

/** Params of `mete/status`: one run, or every run of the workspace. */
export const DaemonStatusParamsSchema = z.strictObject({
	runId: z.string().min(1).optional(),
});

/** A run as `mete/status` shows it; the same fields as `RunView` (engine.ts). */
export const RunViewSchema = z.strictObject({
	id: IdSchema,
	workspaceId: IdSchema,
	templateId: z.string().min(1).nullable(),
	goal: z.string(),
	status: RunStatusSchema,
	pauseReason: PauseReasonSchema.optional(),
	autonomyLevel: z.union([
		z.literal(0),
		z.literal(1),
		z.literal(2),
		z.literal(3),
	]),
	budget: z.strictObject({
		cloudRequests: z.number().int().nonnegative(),
		maxHours: z.number().nonnegative(),
	}),
	createdAt: TimestampSchema,
	startedAt: TimestampSchema.optional(),
	endedAt: TimestampSchema.optional(),
});

/** Result of `mete/status`. */
export const DaemonStatusResultSchema = z.array(RunViewSchema);

/** Result of `mete/run.start`: the run it started. */
export const DaemonRunStartResultSchema = z.strictObject({ runId: IdSchema });

/** Params of `mete/run.resume`: the run to go on with. */
export const DaemonRunIdParamsSchema = z.strictObject({
	runId: z.string().min(1),
});

/** Params of `mete/run.approve`: the run and the human's decision (ADR-048). */
export const DaemonRunApproveParamsSchema = z.strictObject({
	runId: z.string().min(1),
	input: ApprovalInputSchema,
});

/** Result of `mete/run.approve` and `mete/run.resume`: a request that returns nothing sends null. */
export const DaemonDoneResultSchema = z.null();

/**
 * `data` of an error answer: the `EngineError` code of the refused call (`choose_template` with the
 * router's suggestions, ADR-047), or `not_ready` with the lines `mete status` prints while
 * core-engine is not active (ADR-046).
 */
export const DaemonErrorDataSchema = z.discriminatedUnion("code", [
	z.strictObject({
		code: z.enum(["bad_input", "not_found", "not_supported", "invalid_state"]),
	}),
	z.strictObject({
		code: z.literal("choose_template"),
		suggestions: z.array(z.string().min(1)).min(1),
	}),
	z.strictObject({
		code: z.literal("not_ready"),
		reasons: z.array(z.string()).min(1),
	}),
]);

/** What `DaemonErrorDataSchema` parses. */
export type DaemonErrorData = z.infer<typeof DaemonErrorDataSchema>;
