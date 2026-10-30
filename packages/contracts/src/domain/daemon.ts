import { z } from "zod";
import { ApprovalInputSchema, RunPreferSchema } from "./engine.js";
import { type MeteEvent, MeteEventSchema } from "./events.js";
import { CapabilityRefSchema, IdSchema, TimestampSchema } from "./ids.js";
import { NoteTypeSchema } from "./knowledge.js";
import { ModelRefSchema, NeedSchema, TierSchema } from "./llm.js";
import { PolicyActionSchema, PolicyVerdictSchema } from "./policy.js";
import { ModelInfoSchema } from "./provider.js";
import { QuotaUsageSchema } from "./quota.js";
import { PauseReasonSchema, RunStatusSchema } from "./states.js";
import { VaultScopeSchema } from "./vault.js";

// Daemon protocol v26 (ARCHITECTURE.md, ADR-045..ADR-159); mete/event checked with MeteEventSchema.
const text = z.string().min(1);

/** The messages of version 24; the params of mete/run.start are RunStartSchema (engine.ts). */
export const DAEMON_METHODS = {
	status: "mete/status",
	runStart: "mete/run.start",
	runApprove: "mete/run.approve",
	runResume: "mete/run.resume",
	runAllow: "mete/run.allow",
	runModel: "mete/run.model",
	runTranscript: "mete/run.transcript",
	runRemove: "mete/run.remove",
	quota: "mete/quota",
	events: "mete/events",
	audit: "mete/audit",
	templates: "mete/templates",
	stopAll: "mete/stop.all",
	estimate: "mete/estimate",
	templateRead: "mete/template.read",
	chain: "mete/chain",
	checkpointRestore: "mete/checkpoint.restore",
	changes: "mete/changes",
	settings: "mete/settings",
	providerModels: "mete/provider.models",
	providerTest: "mete/provider.test",
	models: "mete/models",
	memberDraft: "mete/member.draft",
	knowledgeSearch: "mete/knowledge.search",
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
	prefer: RunPreferSchema.optional(),
});

/** Result of `mete/status`. */
export const DaemonStatusResultSchema = z.array(RunViewSchema);

/** Result of `mete/run.start`: the run it started. */
export const DaemonRunStartResultSchema = z.strictObject({ runId: IdSchema });

/** Params of `mete/run.resume` and `mete/run.transcript` (ADR-125): the run. */
export const DaemonRunIdParamsSchema = z.strictObject({ runId: text });

/** How far a policy ask is allowed: once, for the run, or a command for good (ADR-121). */
export const AllowScopeSchema = z.enum(["once", "run", "always"]);
export type AllowScope = z.infer<typeof AllowScopeSchema>;

/** Params of `mete/run.allow`: the run and how far its policy ask is allowed (ADR-121). */
export const DaemonRunAllowParamsSchema = z.strictObject({
	runId: text,
	scope: AllowScopeSchema,
});

/** Params of `mete/run.approve`: the run and the human's decision (ADR-048). */
export const DaemonRunApproveParamsSchema = z.strictObject({
	runId: text,
	input: ApprovalInputSchema,
});

/** Params of `mete/run.model`: the run, an optional role id and the preferred model (null clears) (ADR-122). */
export const DaemonRunModelParamsSchema = z.strictObject({
	runId: text,
	roleId: text.optional(),
	model: ModelRefSchema.nullable(),
});
export type DaemonRunModelParams = z.infer<typeof DaemonRunModelParamsSchema>;

/** Whether a provider can carry a run on now (ADR-050). */
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

/** Result of `mete/quota`: one entry per provider module and per custom endpoint (ADR-154), and the pool's units (ADR-054). */
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

/** Params of `mete/estimate`: a template by id, or null for a single agent (ADR-068), and the run's own
 * model choice in mete/run.start's shape (ADR-122, ADR-155). */
export const DaemonEstimateParamsSchema = z.strictObject({
	templateId: text.nullable(),
	prefer: RunPreferSchema.optional(),
});

/** Result of `mete/estimate`: requests per provider, in the order mete/quota lists them, and those no ready provider takes. */
export const DaemonEstimateResultSchema = z.strictObject({
	providers: z.array(
		z.strictObject({
			providerId: text,
			requests: z.number().int().nonnegative(),
		}),
	),
	unassigned: z.number().int().nonnegative(),
});

/** Params of `mete/template.read`: a template by id, for the team editor (ADR-075). */
export const DaemonTemplateReadParamsSchema = z.strictObject({ id: text });

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

/** Params of `mete/changes`: the file whose diff to include, or none for the list alone (ADR-100). */
export const DaemonChangesParamsSchema = z.strictObject({
	path: z.string().min(1).optional(),
});

/**
 * Params of `mete/member.draft` (ADR-108): the member the user is describing, in their own words
 * (an idea such as "backend developer", or a fuller sentence), the language the draft's words are
 * for, and the team's goal when the editor knows it.
 */
export const DaemonMemberDraftParamsSchema = z.strictObject({
	idea: z.string().trim().min(1).max(200),
	language: z.enum(["en", "tr"]).optional(),
	teamGoal: z.string().trim().max(600).optional(),
});

/**
 * Result of `mete/member.draft` (ADR-108): a drafted member for the team editor to offer for
 * review — what the member does, its backstory, the task it would own — and the pages the draft
 * read, empty when the model answered without the web. Every field is a suggestion: the user
 * edits or refuses it, and nothing is written until they save.
 */
export const DaemonMemberDraftResultSchema = z.strictObject({
	goal: z.string().min(1),
	backstory: z.string().optional(),
	task: z.strictObject({ title: z.string().min(1) }).optional(),
	sources: z.array(z.string().url()).default([]).readonly(),
});

/** What `mete/member.draft` answers (ADR-108). */
export type DaemonMemberDraftResult = z.infer<
	typeof DaemonMemberDraftResultSchema
>;

/** Params of `mete/knowledge.search` (ADR-159): the words to look for and a note type to keep. */
export const DaemonKnowledgeSearchParamsSchema = z.strictObject({
	query: z.string().trim().min(1),
	type: NoteTypeSchema.optional(),
});

/** One hit of `mete/knowledge.search`, as knowledge.search@1 gives it (docs/11, Hybrid search). */
export const KnowledgeHitSchema = z.strictObject({
	path: text,
	scope: VaultScopeSchema,
	type: NoteTypeSchema,
	title: text,
	heading: text.optional(),
	snippet: z.string(),
	sources: z.object({ keyword: z.number().int().positive().optional() }),
});

/** What `mete/knowledge.search` answers: the workspace vault's hits, best first. */
export const DaemonKnowledgeSearchResultSchema = z.strictObject({
	results: z.array(KnowledgeHitSchema),
});

/** How a changed file stands, from `vcs.git@2`'s porcelain letters (ADR-100). */
export const ChangedFileSchema = z.strictObject({
	path: z.string().min(1),
	change: z.enum(["added", "modified", "deleted", "renamed", "untracked"]),
});

/**
 * Result of `mete/changes` (ADR-100): the folder's git status as `vcs.git@2` reads it, and the diff
 * of the asked file. `vcs` is false when the folder is not a git repository or vcs.git@2 is not
 * active, and `files` is then empty.
 */
export const DaemonChangesResultSchema = z.strictObject({
	vcs: z.boolean(),
	branch: z.string().min(1).nullable(),
	files: z.array(ChangedFileSchema),
	diff: z.string().optional(),
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

/** Result of `mete/run.approve`, `mete/run.resume`, `mete/run.allow` and `mete/run.model`: a request that returns nothing sends null. */
export const DaemonDoneResultSchema = z.null();

/** `data` of an error answer: the `EngineError` code, `choose_template` or `not_ready` (ADR-046, ADR-047). */
export const DaemonErrorDataSchema = z.discriminatedUnion("code", [
	z.strictObject({
		code: z.enum([
			"bad_input",
			"not_found",
			"not_supported",
			"invalid_state",
			"run_active",
			"no_vcs",
			"invalid",
			"failed",
			"no_model",
			"bad_answer",
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
