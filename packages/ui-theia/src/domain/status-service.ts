import type {
	AllowScope,
	ApprovalInput,
	AuditEntry,
	ContextDraft,
	ContextSnapshot,
	ConversationReplyInput,
	ConversationRunOutput,
	ConversationStartInput,
	DaemonChainResultSchema,
	DaemonChangesResultSchema,
	DaemonCheckpointRestoreResultSchema,
	DaemonEstimateResultSchema,
	DaemonKnowledgeSearchResultSchema,
	DaemonMcpTestResultSchema,
	DaemonMemberDraftResult,
	DaemonModelsResultSchema,
	DaemonProviderModelsResultSchema,
	DaemonProviderTestResultSchema,
	DaemonRegistryPrepareResultSchema,
	DaemonRegistrySearchResultSchema,
	DaemonSettingsResultSchema,
	DaemonStatusResultSchema,
	DaemonTemplateReadResultSchema,
	McpServer,
	MeteEvent,
	ModelRef,
	NeedSchema,
	ProviderState,
	QuotaUsage,
	Result,
	RunPrefer,
	RunStart,
	TaskControlAnswer,
	TaskPendingResult,
	TaskVerificationResult,
	ThreadContextReadResult,
	ThreadContextReplyInput,
	ThreadContextStartInput,
	ThreadListInput,
	ThreadListResult,
	ThreadReadInput,
	ThreadReadResult,
	ThreadReplyInput,
	ThreadStarted,
	ThreadStartInput,
	Tier,
	Transcript,
} from "@mete/contracts";
import type { DaemonFailure } from "./daemon-failure.js";
import type { McpManagementService } from "./mcp-management.js";
import type { SkillManagementService } from "./skill-management.js";

export type { DaemonFailure } from "./daemon-failure.js";

import type { ProviderKey } from "./provider-keys.js";

// What the Theia frontend asks its backend, which owns the daemon process (ARCHITECTURE.md, Daemon protocol).

/** Where the backend serves the daemon service on Theia's connection. */
export const METE_DAEMON_PATH = "/services/mete-daemon";

/** The runs `mete/status` answers, as the daemon protocol schema parses them. */
export type StatusRuns = ReturnType<typeof DaemonStatusResultSchema.parse>;

/** What `mete/template.read` answers (ADR-075), as the daemon protocol schema parses it. */
export type TemplateText = ReturnType<
	typeof DaemonTemplateReadResultSchema.parse
>;

/** A need of a role (docs/08), as the template schema parses it. */
export type Need = ReturnType<typeof NeedSchema.parse>;

/** What `mete/chain` answers (ADR-077), as the daemon protocol schema parses it. */
export type Chain = ReturnType<typeof DaemonChainResultSchema.parse>;

/** What `mete/models` answers (ADR-090): the listed facts of the asked models. */
export type ModelFacts = ReturnType<typeof DaemonModelsResultSchema.parse>;

/** What `mete/checkpoint.restore` answers (ADR-079): the ref restored and the one that undoes it. */
export type Restored = ReturnType<
	typeof DaemonCheckpointRestoreResultSchema.parse
>;

/** What `mete/changes` answers (ADR-100): the folder's working tree and one file's diff. */
export type Changes = ReturnType<typeof DaemonChangesResultSchema.parse>;

/** What `mete/knowledge.search` answers (ADR-159): the workspace vault's hits, best first. */
export type KnowledgeHits = ReturnType<
	typeof DaemonKnowledgeSearchResultSchema.parse
>;

/** What `mete/member.draft` answers (ADR-108): drafted member fields and the pages the draft read. */
export type MemberDraft = DaemonMemberDraftResult;

/** What `mete/settings` answers (ADR-081): the loaded configuration, merged and per file. */
export type Settings = ReturnType<typeof DaemonSettingsResultSchema.parse>;

/** What `mete/provider.models` answers (ADR-087): a custom endpoint's models, or why the listing failed. */
export type EndpointModels = ReturnType<
	typeof DaemonProviderModelsResultSchema.parse
>;

/** What `mete/provider.test` answers (ADR-087): how each model's probe ended, in the order asked. */
export type EndpointTest = ReturnType<
	typeof DaemonProviderTestResultSchema.parse
>;

/** What `mete/mcp.test` answers (ADR-164): a server's tools, or why connecting to it failed. */
export type McpTest = ReturnType<typeof DaemonMcpTestResultSchema.parse>;
export type RegistryResults = ReturnType<
	typeof DaemonRegistrySearchResultSchema.parse
>;
export type RegistryDraft = ReturnType<
	typeof DaemonRegistryPrepareResultSchema.parse
>;

/** What `mete/estimate` answers (ADR-068), as the daemon protocol schema parses it. */
export type Estimate = ReturnType<typeof DaemonEstimateResultSchema.parse>;

/** The filters of mete/audit (ADR-053); each one is optional. */
export type AuditFilter = {
	readonly runId?: string;
	readonly verdict?: AuditEntry["verdict"];
	readonly action?: AuditEntry["action"];
};

/** What the backend calls on each frontend: an event the daemon of a folder published. */
export interface MeteDaemonClient {
	onEvent(workspaceDir: string, event: MeteEvent): void;
}

/** The backend side of the METE panels; the first call for a folder starts its daemon. */
export const MeteDaemonService = Symbol("MeteDaemonService");
export interface MeteDaemonService
	extends McpManagementService,
		SkillManagementService {
	/** Persisted per-attempt verification; events only trigger this authoritative read (ADR-187). */
	verification(
		workspaceDir: string,
		runId: string,
	): Promise<Result<TaskVerificationResult, DaemonFailure>>;
	/** Explicit editor snapshots; unavailable @2 ports never downgrade (ADR-183). */
	threadContextPrepare(
		dir: string,
		input: ContextDraft,
	): Promise<Result<ContextSnapshot, DaemonFailure>>;
	threadContextStart(
		dir: string,
		input: ThreadContextStartInput,
	): Promise<Result<ThreadStarted, DaemonFailure>>;
	threadContextReply(
		dir: string,
		input: ThreadContextReplyInput,
	): Promise<Result<ThreadStarted, DaemonFailure>>;
	threadContextRead(
		dir: string,
		input: ThreadReadInput,
	): Promise<Result<ThreadContextReadResult, DaemonFailure>>;
	/** Durable thread intent and exact current-head reply (ADR-182). */
	threadStart(
		dir: string,
		input: ThreadStartInput,
	): Promise<Result<ThreadStarted, DaemonFailure>>;
	threadReply(
		dir: string,
		input: ThreadReplyInput,
	): Promise<Result<ThreadStarted, DaemonFailure>>;
	/** Local search/paging and retained history, with explicit read failures. */
	threadList(
		dir: string,
		input: ThreadListInput,
	): Promise<Result<ThreadListResult, DaemonFailure>>;
	threadRead(
		dir: string,
		input: ThreadReadInput,
	): Promise<Result<ThreadReadResult, DaemonFailure>>;
	/** Authoritative task waits, including while independent tasks are running (ADR-181). */
	taskPending(
		workspaceDir: string,
		runId: string,
	): Promise<Result<TaskPendingResult, DaemonFailure>>;
	/** Answers only the captured task request; never grants configuration permissions. */
	taskAnswer(
		workspaceDir: string,
		input: TaskControlAnswer,
	): Promise<Result<null, DaemonFailure>>;
	conversationStart(
		workspaceDir: string,
		input: ConversationStartInput,
	): Promise<Result<ConversationRunOutput, DaemonFailure>>;
	conversationReply(
		workspaceDir: string,
		input: ConversationReplyInput,
	): Promise<Result<ConversationRunOutput, DaemonFailure>>;
	/** Read-only catalog discovery and draft preparation; neither installs nor connects. */
	registrySearch(
		workspaceDir: string,
		query: string,
	): Promise<Result<RegistryResults, DaemonFailure>>;
	registryPrepare(
		workspaceDir: string,
		name: string,
	): Promise<Result<RegistryDraft, DaemonFailure>>;
	status(
		workspaceDir: string,
		runId?: string,
	): Promise<Result<StatusRuns, DaemonFailure>>;
	/** Starts a run in the folder; its events reach the frontend through MeteDaemonClient. */
	startRun(
		workspaceDir: string,
		req: RunStart,
	): Promise<Result<{ readonly runId: string }, DaemonFailure>>;
	/** Continues a completed single-agent conversation in a new run (ADR-178). */
	replyRun(
		workspaceDir: string,
		input: import("@mete/contracts").RunReplyInput,
	): Promise<Result<{ readonly runId: string }, DaemonFailure>>;
	/** The human's decision on a run paused for approval; the engine judges whether it applies. */
	approve(
		workspaceDir: string,
		runId: string,
		input: ApprovalInput,
	): Promise<Result<null, DaemonFailure>>;
	/** The providers `mete key list` names, with whether each has a key (ADR-049). */
	keys(): Promise<Result<ProviderKey[], DaemonFailure>>;
	/** Saves a provider key through `mete key set` and restarts the daemon, which then reads it. */
	setKey(providerId: string, key: string): Promise<Result<null, DaemonFailure>>;
	/** Goes on with a paused run. */
	resume(
		workspaceDir: string,
		runId: string,
	): Promise<Result<null, DaemonFailure>>;
	/** Deletes an ended run with its worktrees, branches, checkpoints and history (ADR-143). */
	remove(
		workspaceDir: string,
		runId: string,
	): Promise<Result<null, DaemonFailure>>;
	/** Grants the run's pending ask (once, run, or a command always) and resumes (ADR-121). */
	allow(
		workspaceDir: string,
		runId: string,
		scope: AllowScope,
	): Promise<Result<null, DaemonFailure>>;
	/** Sets or clears a run-specific model preference mid-run (null clears) (ADR-122). */
	model(
		workspaceDir: string,
		runId: string,
		model: ModelRef | null,
		roleId?: string,
	): Promise<Result<null, DaemonFailure>>;
	/** The kill switch (ADR-065): cancels every run of the folder that has not ended. */
	stopAll(
		workspaceDir: string,
	): Promise<Result<{ readonly cancelled: readonly string[] }, DaemonFailure>>;
	/** A run's persisted events in order, and how many rows no longer parse (ADR-051). */
	events(
		workspaceDir: string,
		runId: string,
	): Promise<
		Result<
			{ readonly events: readonly MeteEvent[]; readonly unreadable: number },
			DaemonFailure
		>
	>;
	/** The steps of a run's saved conversation, masked by the daemon (ADR-125). */
	transcript(
		workspaceDir: string,
		runId: string,
	): Promise<Result<Transcript, DaemonFailure>>;
	/** The workspace audit log, newest first, filtered by run, verdict and action (ADR-053). */
	audit(
		workspaceDir: string,
		filter: AuditFilter,
	): Promise<
		Result<{ readonly entries: readonly AuditEntry[] }, DaemonFailure>
	>;
	/** The team templates the router may pick, by id, name and description (ADR-058). */
	templates(workspaceDir: string): Promise<
		Result<
			{
				readonly templates: readonly {
					readonly id: string;
					readonly name: string;
					readonly description?: string | undefined;
				}[];
			},
			DaemonFailure
		>
	>;
	/** The requests a template, or a single agent for null, is estimated to need per ready provider (ADR-068),
	 * with the run's own model choice (ADR-155). */
	estimate(
		workspaceDir: string,
		templateId: string | null,
		prefer?: RunPrefer,
	): Promise<Result<Estimate, DaemonFailure>>;
	/** The models a tier's chain would try for the needs, for the team editor's pinned model (ADR-077). */
	chain(
		workspaceDir: string,
		tier: Tier,
		needs: readonly Need[],
	): Promise<Result<Chain, DaemonFailure>>;
	/** The listed facts of the asked models, such as their context window, for the Team view (ADR-090). */
	models(
		workspaceDir: string,
		models: readonly ModelRef[],
	): Promise<Result<ModelFacts, DaemonFailure>>;
	/** Restarts the folder's daemon so it loads the configuration again (ADR-083). */
	restart(): Promise<void>;
	/** Atomically refuses active work, then restarts exactly this workspace's daemon. */
	restartIdle(workspaceDir: string): Promise<Result<null, DaemonFailure>>;
	/** The configuration the folder's daemon loaded, every string masked (ADR-081). */
	settings(workspaceDir: string): Promise<Result<Settings, DaemonFailure>>;
	/** A custom endpoint's models; refused while it is not loaded or has no key (ADR-087). */
	providerModels(
		workspaceDir: string,
		providerId: string,
	): Promise<Result<EndpointModels, DaemonFailure>>;
	/** One probe per model, sent to the endpoint directly, only when the user presses Test (ADR-087). */
	providerTest(
		workspaceDir: string,
		providerId: string,
		models: readonly string[],
	): Promise<Result<EndpointTest, DaemonFailure>>;
	/** Connects to one loaded MCP server and lists its tools, only when the user presses Test; refused
	 * while METE has not loaded it (ADR-164). */
	mcpTest(
		workspaceDir: string,
		id: string,
		expected?: McpServer,
	): Promise<Result<McpTest, DaemonFailure>>;
	/** The open folder's working tree, and one file's diff when `path` names it (ADR-100). */
	changes(
		workspaceDir: string,
		path?: string,
	): Promise<Result<Changes, DaemonFailure>>;
	/** The workspace vault's notes that match the words, best first (ADR-159). */
	knowledgeSearch(
		workspaceDir: string,
		query: string,
	): Promise<Result<KnowledgeHits, DaemonFailure>>;
	/** One member drafted from the user's idea (ADR-108): every field a suggestion for review. */
	memberDraft(
		workspaceDir: string,
		idea: string,
		language: "en" | "tr",
		teamGoal?: string,
	): Promise<Result<MemberDraft, DaemonFailure>>;
	/** Restores a paused or ended run's checkpoint by the id of its checkpoint.created event (ADR-079). */
	checkpointRestore(
		workspaceDir: string,
		runId: string,
		checkpointId: string,
	): Promise<Result<Restored, DaemonFailure>>;
	/** The text of the template file the daemon would load for an id, and its folder, for the team editor (ADR-075). */
	readTemplate(
		workspaceDir: string,
		id: string,
	): Promise<Result<TemplateText, DaemonFailure>>;
	/** Whether each provider can carry a run on now (ADR-050), and the pool's units (ADR-054, ADR-055). */
	quota(workspaceDir: string): Promise<
		Result<
			{
				readonly providers: readonly ProviderState[];
				readonly units: readonly QuotaUsage[];
			},
			DaemonFailure
		>
	>;
}
