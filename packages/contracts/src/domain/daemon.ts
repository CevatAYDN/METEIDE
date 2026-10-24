import { z } from "zod";
import { ApprovalInputSchema } from "./engine.js";
import { type MeteEvent, MeteEventSchema } from "./events.js";
import { CapabilityRefSchema, IdSchema, TimestampSchema } from "./ids.js";
import { ModelRefSchema, NeedSchema, TierSchema } from "./llm.js";
import { PolicyActionSchema, PolicyVerdictSchema } from "./policy.js";
import { CustomProviderIdSchema, ModelInfoSchema } from "./provider.js";
import { QuotaUsageSchema } from "./quota.js";
import { PauseReasonSchema, RunStatusSchema } from "./states.js";

// Daemon protocol version 18 from ARCHITECTURE.md (Daemon protocol, ADR-045 to ADR-090).
// The notification `mete/event` carries a MeteEvent, so it is checked with MeteEventSchema (events.ts).

/** The messages of version 18; the params of mete/run.start are RunStartSchema (engine.ts). */
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
	chain: "mete/chain",
	checkpointRestore: "mete/checkpoint.restore",
	settings: "mete/settings",
	providerModels: "mete/provider.models",
	providerTest: "mete/provider.test",
	models: "mete/models",
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

/** Params of `mete/chain`: a tier and the needs of a member, for the team editor's pinned model (ADR-077). */
export const DaemonChainParamsSchema = z.strictObject({
	tier: TierSchema,
	needs: z.array(NeedSchema),
});

/** Result of `mete/chain`: the models the gateway would try for them, best first, without a pin. */
export const DaemonChainResultSchema = z.strictObject({
	models: z.array(ModelRefSchema),
});

/** Params of `mete/models`: the models whose facts the Team view's context share needs (ADR-090). */
export const DaemonModelsParamsSchema = z.strictObject({
	models: z.array(ModelRefSchema),
});

/** Result of `mete/models`: each asked model the gateway's listing has, in the order asked. */
export const DaemonModelsResultSchema = z.strictObject({
	models: z.array(ModelInfoSchema),
});

/** Params of `mete/checkpoint.restore`: the run and the id of its `checkpoint.created` event (ADR-079). */
export const DaemonCheckpointRestoreParamsSchema = z.strictObject({
	runId: IdSchema,
	checkpointId: IdSchema,
});

/** Result of `mete/checkpoint.restore`: the ref restored and the checkpoint that undoes it. */
export const DaemonCheckpointRestoreResultSchema = z.strictObject({
	ref: z.string().min(1),
	undo: z.string().min(1),
});

// One file's value of a section as the loader read it; the desktop shows it as text, never parses it.
const SettingsFileSchema = z.strictObject({
	file: z.string().min(1),
	value: z.unknown(),
});

/**
 * Result of `mete/settings` (no params, ADR-081): each configuration section the daemon loaded, merged
 * as modules read it and per file, and when it was loaded; every string is already masked.
 */
export const DaemonSettingsResultSchema = z.strictObject({
	loadedAt: TimestampSchema,
	sections: z.array(
		z.strictObject({
			name: z.string().min(1),
			merged: z.unknown(),
			global: SettingsFileSchema.optional(),
			workspace: SettingsFileSchema.optional(),
		}),
	),
	// The global settings.yaml, the desktop forms' global save target (ADR-082); optional, as ADR-077 adds.
	globalFile: z.string().min(1).optional(),
});

/** Params of `mete/provider.models`: a custom endpoint by its provider id (ADR-087). */
export const DaemonProviderModelsParamsSchema = z.strictObject({
	providerId: CustomProviderIdSchema,
});

// A provider's failure as the daemon passes it on: its code, status and masked message, no headers.
const ProviderFailureSchema = z.strictObject({
	code: z.enum([
		"rate_limited",
		"unauthorized",
		"bad_request",
		"server",
		"network",
		"aborted",
	]),
	message: z.string(),
	status: z.number().int().optional(),
});

/** Result of `mete/provider.models`: the endpoint's models as its listing gives them, or why it failed. */
export const DaemonProviderModelsResultSchema = z.union([
	z.strictObject({ models: z.array(ModelInfoSchema) }),
	z.strictObject({ failed: ProviderFailureSchema }),
]);

/** Params of `mete/provider.test`: the endpoint and the models to probe, one call each (docs/09). */
export const DaemonProviderTestParamsSchema = z.strictObject({
	providerId: CustomProviderIdSchema,
	models: z.array(z.string().min(1)).min(1),
});

/** Result of `mete/provider.test`: per model, in the order asked, how its probe ended. */
export const DaemonProviderTestResultSchema = z.strictObject({
	results: z.array(
		z.discriminatedUnion("ok", [
			z.strictObject({
				modelId: z.string().min(1),
				ok: z.literal(true),
				ms: z.number().int().nonnegative(),
			}),
			z.strictObject({
				modelId: z.string().min(1),
				ok: z.literal(false),
				failed: ProviderFailureSchema,
			}),
		]),
	),
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
		code: z.enum([
			"bad_input",
			"not_found",
			"not_supported",
			"invalid_state",
			// A refused checkpoint.restore@1 (ADR-079).
			"run_active",
			"no_vcs",
			"invalid",
			"failed",
		]),
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
