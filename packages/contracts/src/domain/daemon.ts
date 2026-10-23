import { z } from "zod";
import { IdSchema, TimestampSchema } from "./ids.js";
import { PauseReasonSchema, RunStatusSchema } from "./states.js";

// Daemon protocol version 2 from ARCHITECTURE.md (Daemon protocol, ADR-045 and ADR-046). The notification
// `mete/event` carries a MeteEvent, so it is checked with MeteEventSchema (events.ts).

/** The two messages of versions 1 and 2. */
export const DAEMON_METHODS = {
	status: "mete/status",
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

/**
 * `data` of an error answer: the `EngineError` code of the refused call, or `not_ready` with the
 * lines `mete status` prints while core-engine is not active (ADR-046).
 */
export const DaemonErrorDataSchema = z.discriminatedUnion("code", [
	z.strictObject({
		code: z.enum([
			"bad_input",
			"not_found",
			"not_supported",
			"invalid_state",
			"choose_template",
		]),
	}),
	z.strictObject({
		code: z.literal("not_ready"),
		reasons: z.array(z.string()).min(1),
	}),
]);

/** What `DaemonErrorDataSchema` parses. */
export type DaemonErrorData = z.infer<typeof DaemonErrorDataSchema>;
