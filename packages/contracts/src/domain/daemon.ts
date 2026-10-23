import { z } from "zod";
import { ApprovalInputSchema } from "./engine.js";
import { type MeteEvent, MeteEventSchema } from "./events.js";
import { CapabilityRefSchema, IdSchema, TimestampSchema } from "./ids.js";
import { PolicyActionSchema, PolicyVerdictSchema } from "./policy.js";
import { QuotaUsageSchema } from "./quota.js";
import { PauseReasonSchema, RunStatusSchema } from "./states.js";

// Daemon protocol version 13 from ARCHITECTURE.md (Daemon protocol, ADR-045 to ADR-075).
// The notification `mete/event` carries a MeteEvent, so it is checked with MeteEventSchema (events.ts).

/** The messages of version 13; the params of mete/run.start are RunStartSchema (engine.ts). */
export const DAEMON_METHODS = {
	status: "mete/status",
	runStart: "mete/run.start",
	runApprove: "mete/run.approve",
	runResume: "mete/run.resume",
	quota: "mete/quota",
	events: "mete/events",
	audit: "mete/audit",
	templates: "mete/templates",
	stopAll: "mete/stop.all",
	estimate: "mete/estimate",
	templateRead: "mete/template.read",
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

/**
 * Whether a provider can carry a run on now (ADR-050): ready, no key, not active for another
 * reason, its quota spent until `resetsAt`, or no usable model (privacy rules, model mode, a
 * refused key).
 */
export const ProviderStateSchema = z.discriminatedUnion("state", [
	z.strictObject({
		id: z.string().min(1),
		state: z.enum(["ready", "no_key", "inactive", "unusable"]),
	}),
	z.strictObject({
		id: z.string().min(1),
		state: z.literal("exhausted"),
		resetsAt: TimestampSchema,
	}),
]);

/** What `ProviderStateSchema` parses. */
export type ProviderState = z.infer<typeof ProviderStateSchema>;

/** Result of `mete/quota`: one entry per provider module, and the pool's units (ADR-054). */
export const DaemonQuotaResultSchema = z.strictObject({
	providers: z.array(ProviderStateSchema),
	/** quota.reserve@4 `usage()` as it is (ADR-054), history included since version 9 (ADR-055). */
	units: z.array(QuotaUsageSchema),
});

/**
 * Result of `mete/events` (params: DaemonRunIdParamsSchema): the run's persisted events in order,
 * and how many rows no longer parse, which are counted and never dropped silently (ADR-051).
 */
export const DaemonEventsResultSchema = z.strictObject({
	// As in parseEvent: the schema checks each event, MeteEvent restores the precise union.
	events: z.array(MeteEventSchema).transform((es) => es as MeteEvent[]),
	unreadable: z.number().int().nonnegative(),
});

/** Params of `mete/audit`: the filters of ADR-053, each optional; `limit` caps the rows. */
export const DaemonAuditParamsSchema = z.strictObject({
	runId: z.string().min(1).optional(),
	verdict: PolicyVerdictSchema.shape.verdict.optional(),
	action: PolicyActionSchema.optional(),
	limit: z.number().int().positive().optional(),
});

/** One row of the workspace audit log (SECURITY.md, Audit log). */
export const AuditEntrySchema = z.strictObject({
	seq: z.number().int().positive(),
	ts: TimestampSchema,
	runId: IdSchema.nullable(),
	agentId: IdSchema.nullable(),
	action: PolicyActionSchema,
	capability: CapabilityRefSchema,
	adapterId: z.string().min(1),
	argsSha256: z.string().regex(/^[0-9a-f]{64}$/),
	verdict: PolicyVerdictSchema.shape.verdict,
	rule: z.string().min(1),
	tainted: z.boolean(),
});

/** What `AuditEntrySchema` parses. */
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

/** Result of `mete/audit`: the rows, newest first. */
export const DaemonAuditResultSchema = z.strictObject({
	entries: z.array(AuditEntrySchema),
});

/** Result of `mete/templates`: the team templates the router may pick, by id (ADR-058). */
export const DaemonTemplatesResultSchema = z.strictObject({
	templates: z.array(
		z.strictObject({
			id: z.string().min(1),
			name: z.string().min(1),
			description: z.string().min(1).optional(),
		}),
	),
});

/** Result of `mete/stop.all`: the runs it cancelled, the kill switch of SECURITY.md (ADR-065). */
export const DaemonStopAllResultSchema = z.strictObject({
	cancelled: z.array(IdSchema),
});

/** Params of `mete/estimate`: a template by id, or null for a single agent (ADR-068). */
export const DaemonEstimateParamsSchema = z.strictObject({
	templateId: z.string().min(1).nullable(),
});

/** Result of `mete/estimate`: requests per provider, in the order mete/quota lists them, and those no ready provider takes. */
export const DaemonEstimateResultSchema = z.strictObject({
	providers: z.array(
		z.strictObject({
			providerId: z.string().min(1),
			requests: z.number().int().nonnegative(),
		}),
	),
	unassigned: z.number().int().nonnegative(),
});

/** Params of `mete/template.read`: a template by id, for the team editor (ADR-075). */
export const DaemonTemplateReadParamsSchema = z.strictObject({
	id: z.string().min(1),
});

/** Result of `mete/template.read`: the text of the file `mete/templates` would load, and its folder. */
export const DaemonTemplateReadResultSchema = z.strictObject({
	id: z.string().min(1),
	source: z.enum(["workspace", "builtIn"]),
	yaml: z.string(),
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
