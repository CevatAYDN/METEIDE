# 06 Kernel and modules

Repository file: `docs/06-kernel-and-modules.md`. Depends on: 03 Architecture.

The kernel knows only modules, capabilities, events and configuration; everything else is a module. Modules are either essential (the system cannot run a task without them) or optional (removable at any time without breaking startup or single-agent tasks).

## Kernel API

```ts
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export type CapabilityRef = `${string}@${number}`;          // "knowledge.search@1"
export type Permission =
  | "fs.read" | "fs.write" | "shell" | "net" | "secrets" | "ui" | "runtime.install" | "llm";
export type ActivationEvent =
  | "onStartup" | "onWorkspaceOpen" | `onCapability:${CapabilityRef}` | `onCommand:${string}`;

export interface ModuleManifest {
  id: string;                    // kebab-case, unique
  version: string;               // SemVer
  displayName: string;
  class: "essential" | "optional";
  trust: "core" | "first-party" | "third-party";
  provides: CapabilityRef[];
  requires: CapabilityRef[];     // not activated until all resolve
  optional: CapabilityRef[];     // used when present
  activation: ActivationEvent[];
  isolation: "in-process" | "worker" | "process";   // third-party MUST be "process"
  permissions: Permission[];
}

export interface MeteModule {
  readonly manifest: ModuleManifest;
  activate(ctx: ModuleContext): Promise<Result<void, ModuleError>>;
  deactivate(): Promise<void>;   // MUST dispose everything it created
}

export interface ModuleContext {
  capabilities: CapabilityRegistry;
  events: EventBus;
  config: ConfigReader;
  logger: Logger;
  storage?: ScopedStorage;       // namespaced by module id; only when `requires` has storage.sql@1
  secrets?: SecretStore;         // only with "secrets" permission
  disposables: DisposableStore;
}

export type ModuleError = { code: "activation_failed"; moduleId: string; message: string };  // message is for logs; users see i18n text

type LogFn = (fields: Readonly<Record<string, unknown>>, msg: string) => void;   // pino argument order
export interface Logger { error: LogFn; warn: LogFn; info: LogFn; debug: LogFn }

// At load the kernel checks YAML syntax and its own files; get() validates a module's section (ARCHITECTURE.md, Configuration).
export type ConfigInvalid = { code: "config_invalid"; file: string; path: string; reason: string };
export interface ConfigReader {
  get<T>(key: string, schema: ZodType<T>): Result<T, ConfigInvalid>;
}

export interface DisposableStore { add(d: Disposable): void; dispose(): void }

// storage.sql@1, defined in @mete/contracts. Each module owns unique table names (tab 07 `events`, tab 11 `graph_nodes`);
// storage records applied migrations per module id in its own `storage_migrations` table, so ledgers never collide.
export type Migration = { id: string; sql: string };   // applied once, in array order, each in a transaction
export type MigrationError = { code: "migration_failed"; moduleId: string; migrationId: string; message: string };
export interface ScopedStorage {
  workspace: Database;           // better-sqlite3 handle on .mete/mete.db; wrap it with drizzle() to query
                                 // (Drizzle's driver imports better-sqlite3, so that module lists it too, same version)
  global: Database;              // better-sqlite3 handle on mete.db in the global data folder
  migrate(scope: "workspace" | "global", migrations: Migration[]): Result<void, MigrationError>;
}
export interface StorageSqlAdapter { scopeFor(moduleId: string): ScopedStorage }   // the composition root builds ModuleContext.storage with it

// policy.check@1 and secrets.mask@1, defined in @mete/contracts; decision order in SECURITY.md (Policy file).
export type PolicyAction = "fs.write" | "fs.delete" | "fs.write.outside" | "shell.exec" | "git.commit" | "git.push" | "git.merge"
  | "net.fetch" | "plugin.install" | "mcp.install" | "mcp.call" | "mcp.sampling" | "runtime.install" | "release.publish" | "vault.write.personal";
export type PolicyCheckInput = { action: PolicyAction; capability: CapabilityRef; adapterId: string; args: unknown;   // args are hashed into the audit log
  runId?: string; agentId?: string; path?: string; command?: string; tainted?: boolean };
export type PolicyVerdict = { verdict: "allow" | "ask" | "deny"; rule: string };   // rule names the step that fired
export type AuditFailed = { code: "audit_failed"; message: string };            // callers treat it as deny
export interface PolicyCheckAdapter { check(input: PolicyCheckInput): Result<PolicyVerdict, AuditFailed> }
export type GrantScope = "once" | "run";                                         // policy.grant@1 (ADR-121)
export type PolicyAsk = { action: PolicyAction; capability: CapabilityRef; adapterId: string; command?: string; path?: string };   // a policy.asked payload, masked
export interface PolicyGrantAdapter { grant(input: { runId: string; scope: GrantScope; ask: PolicyAsk }): void }
export interface SecretsMaskAdapter { mask(text: string): Promise<{ text: string; masked: number }> }   // tab 09 replacement format

// provider.chat@2, provider.embed@2 and provider.rerank@1, defined in @mete/contracts; ProviderAdapter and ModelInfo
// are in tab 09. Each provider module provides one adapter object under every ref it supports.
// provider.chat@2 (ADR-042) adds the optional ModelInfo.price = { input, output }, US dollars per million tokens, for paid
// models; quota.reserve@2 adds the unit usd_per_day. provider.embed@2 (ADR-152) adds embedModels, the provider's embedding
// models as ModelInfo.
export type ContentPart = { type: "text"; text: string } | { type: "image"; mediaType: string; data: string };   // base64 image
export type ToolCall = { id: string; name: string; args: unknown };
export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | ContentPart[] }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };
export type ToolSpec = { name: string; description: string; parameters: unknown };   // parameters is a JSON Schema
export type ChatRequest = { model: string; messages: ChatMessage[]; tools?: ToolSpec[]; maxTokens?: number; temperature?: number };
export type ProviderError = { code: "rate_limited" | "unauthorized" | "bad_request" | "server" | "network" | "aborted";
  message: string; status?: number; headers?: Headers };   // status and headers go to observe()
export type ChatChunk =
  | { type: "text"; text: string }
  | { type: "tool-call"; id: string; name: string; args: unknown }
  | { type: "finish"; reason: "stop" | "length" | "tool-calls" | "content-filter" | "other"; usage: { prompt: number; completion: number } }
  | { type: "error"; error: ProviderError };   // the last chunk; chat never throws for a provider failure
export type EmbedRequest = { model: string; input: string[]; purpose: "query" | "document" };   // what the vectors are for
export type EmbedResponse = { vectors: number[][] };   // one vector per input, in order
export type RerankRequest = { model: string; query: string; documents: string[] };
export type RerankResponse = { scores: number[] };     // one score per document, in order

// llm.chat@2, defined in @mete/contracts: the gateway's routed chat (tab 09, Gateway). The caller names a tier
// or one exact model; the gateway resolves the chain, reserves quota and moves down the chain on failures.
// @2 (ADR-056) adds too_large: no model of the chain can take a request this large; the run folds its older turns
// once and asks again, then pauses with no_model (tab 08).
export type Tier = "reasoning" | "coder" | "fast" | "long-context" | "vision";
export type ModelRef = { providerId: string; modelId: string };
export type LlmChatRequest = Omit<ChatRequest, "model"> & {
  target: { tier: Tier } | ModelRef;
  runId: string; priority: 0 | 1 | 2;                       // as in QuotaRequest
  needs?: ("tool_calling" | "vision" | "long_context")[];   // the role's needs (tab 08)
  avoidFamilies?: string[];                                 // families of the roles in prefer_different_family_than
  prefer?: ModelRef };                                      // the role's pinned model, first when a candidate (ADR-077)
export type LlmError = ProviderError | { code: "no_model"; message: string }
  | { code: "quota_exhausted"; message: string; resumesAt: string }    // run pause reasons no_model and quota
  | { code: "too_large"; message: string };   // @2: folded once, then the run pauses with reason no_model (tab 08); the message names the estimate
export type LlmChunk =
  | Exclude<ChatChunk, { type: "error" }>
  | { type: "model"; providerId: string; modelId: string; reason: "first" | "quota" | "failed" }
  | { type: "error"; error: LlmError };                    // the last chunk; chat never throws for a model failure
export interface LlmChatAdapter {
  chat(req: LlmChatRequest, signal: AbortSignal): AsyncIterable<LlmChunk>;
}

// llm.embed@1, defined in @mete/contracts: the gateway's routed embeddings (tab 09, Gateway; ADR-152). Embedding is no
// tier and takes no pin: the chain is the embedding models the model mode and the privacy filter allow.
export type LlmEmbedRequest = Omit<EmbedRequest, "model"> & { runId: string; priority: 0 | 1 | 2 };
export type LlmEmbedResponse = EmbedResponse & { model: ModelRef };   // the model that embedded them; vectors keep it (tab 11)
export interface LlmEmbedAdapter {
  embed(req: LlmEmbedRequest, signal: AbortSignal): Promise<Result<LlmEmbedResponse, LlmError>>;
}

// ModuleContext.secrets: the operating system keychain (tab 12), service "mete"; account names in tab 09.
export type SecretError = { code: "secret_failed"; message: string };
export interface SecretStore {
  get(name: string): Promise<Result<string | undefined, SecretError>>;
  set(name: string, value: string): Promise<Result<void, SecretError>>;
  delete(name: string): Promise<Result<boolean, SecretError>>;   // false when there was nothing to delete
}

// fs.*@1 and shell.exec@1, defined in @mete/contracts with a Zod schema per input; rules in tab 10 (Built-in tools).
// Each capability is a ToolAdapter of its input and output. Paths are absolute or relative to the workspace root;
// outputs name paths relative to it.
export type ToolContext = { runId?: string; agentId?: string; tainted?: boolean; cwd?: string; signal: AbortSignal };   // passed on to policy.check@1
// cwd is a task's worktree (tab 08): tools-fs, tools-shell and vcs-git treat it as the workspace for that call, confine the call to
// it and read .meteignore from the real workspace; no cwd means the workspace. A context field is optional and additive, so adding
// one is no capability change and an adapter that does not know it ignores it (an MCP-mapped adapter keeps using the workspace) [D].
export type ToolError = { message: string } & (
  | { code: "bad_input" | "not_found" | "outside_workspace" | "ignored" | "exists" | "is_directory" | "binary" | "io" }
  | { code: "match_count"; count: number }                 // fs.edit: oldStr did not match exactly once
  | { code: "denied" | "approval_required"; rule: string }); // the policy verdict deny or ask, with its rule
export interface ToolAdapter<I, O> { run(input: I, ctx: ToolContext): Promise<Result<O, ToolError>> }
export type FsReadInput = { path: string; startLine?: number; endLine?: number };   // 1-based, inclusive
export type FsReadOutput = { content: string; totalLines: number; lineEnding: "lf" | "crlf" | "mixed" | "none" };
export type FsWriteInput = { path: string; content: string; createOnly?: boolean } | { path: string; delete: true };
export type FsWriteOutput = { bytes: number };            // 0 for a delete
export type FsEditInput = { path: string; oldStr: string; newStr: string; replaceAll?: boolean };
export type FsEditOutput = { replacements: number };
export type FsListInput = { path: string };               // children of a folder; folder paths end with "/"
export type FsGlobInput = { pattern: string; path?: string };
export type FsPathsOutput = { paths: string[] };          // fs.list@1 and fs.glob@1
export type FsGrepInput = { pattern: string; glob?: string; caseSensitive?: boolean; maxResults?: number };
export type FsGrepOutput = { matches: { path: string; line: number; text: string }[]; truncated: boolean };
export type ShellExecInput = { command: string; cwd?: string; timeoutSec?: number; env?: Record<string, string> };
export type ShellExecOutput = { exitCode: number | null; stdout: string; stderr: string;   // null when killed
  os: string; shell: string; timedOut: boolean };         // the model learns the OS and shell from every call
// The tools a model may call are TOOL_CATALOG in @mete/contracts: { ref, schema, description, external?, write? } per
// capability (tab 08, Single agent); core-engine reads it, so a new tool adds an entry and an adapter, not core code.
// web.fetch@1 and web.search@1, defined in @mete/contracts; rules in tab 10 (Built-in tools). They return ToolError too.
export type WebFetchInput = { url: string };                            // http or https only
export type WebFetchOutput = { markdown: string; title: string; finalUrl: string };   // finalUrl: where redirects ended
export type WebSearchInput = { query: string; maxResults?: number };    // maxResults defaults to 8
export type WebSearchOutput = { results: { title: string; url: string; snippet: string }[] };
// browser.screenshot@2 and seo.audit@2, defined in @mete/contracts; rules in tab 10 (Built-in tools). Paths are workspace-relative in .mete/assets/.
export type BrowserScreenshotInput = ({ url: string } | { folder: string }) & { fullPage?: boolean };    // fullPage defaults to false;
  // folder: a built site (with an index.html) in the workspace or the task's worktree, which the tool serves itself
export type BrowserScreenshotOutput = { path: string; width: number; height: number };
export type SeoScores = { performance: number; accessibility: number; bestPractices: number; seo: number };   // 0-100
export type SeoAuditInput = { url: string } | { folder: string };
export type SeoAuditOutput = { scores: SeoScores; audits: { id: string; title: string; score: number | null; details?: string }[];
  reportPath: string };                                             // score null: Lighthouse does not score that audit
// vault.read@1 and vault.write@1, defined in @mete/contracts; rules in tab 11 (Vaults, ADR-145). They return ToolError too.
export type VaultScope = "workspace" | "personal";                      // default workspace; personal is not_found until it is chosen
export type VaultReadInput = { path: string; scope?: VaultScope };     // a .md path relative to the vault
export type VaultReadOutput = { path: string; content: string };      // the note as written; a private note is refused
export type VaultWriteInput = { type: "lesson" | "entity" | "decision" | "journal"; title: string; body: string;
  tags?: string[]; scope?: VaultScope };
export type VaultWriteOutput = { path: string; created: boolean };    // false: an existing note was updated or the journal appended
// knowledge.search@1, defined in @mete/contracts; rules in tab 11 (Hybrid search, ADR-149). It returns ToolError too.
export type NoteType = "decision" | "lesson" | "entity" | "journal" | "inbox";
export type KnowledgeSearchInput = { query: string; scope?: VaultScope | "all"; k?: number;   // scope all, k 8 (1-30)
  type?: NoteType; path?: string };                                 // path: a prefix inside the vault
export type KnowledgeHit = { path: string; scope: VaultScope; type: NoteType; title: string; heading?: string;
  snippet: string; sources: { keyword?: number } };                 // snippet at most 40 tokens; 1-based rank per source
export type KnowledgeSearchOutput = { results: KnowledgeHit[] };    // best first, at most k
// events.read@1, defined in @mete/contracts (ADR-144): one run's catalog events in seq order, and the rows that no longer parse.
export type BrokenEvent = { seq: number; issues: string };
export type RunEvents = { events: MeteEvent[]; broken: BrokenEvent[] };
export interface EventsReadAdapter { read(runId: string): RunEvents }
// mcp.tools@1, defined in @mete/contracts with McpConfigSchema for .mete/mcp.yaml (tab 10, MCP client); policy action mcp.call.
export type McpServer =
  | { id: string; transport: "stdio"; runtime: "node" | "python" | "binary" | "container"; command: string; args?: string[];
      env?: Record<string, string>; permissions?: Permission[] }
  | { id: string; transport: "streamable-http" | "sse"; url: string; auth?: "oauth" | "none"; permissions?: Permission[] };
export type McpToolInfo = { server: string; name: string; description: string; inputSchema: unknown };
export type McpContent = { type: "text"; text: string } | { type: "image"; mediaType: string; path: string }   // image in .mete/assets/
  | { type: "resource"; uri: string; mimeType?: string };
export type McpCallInput = { server: string; tool: string; args?: Record<string, unknown> };
export type McpCallOutput = { content: McpContent[]; isError: boolean };   // isError is the server's own flag
export interface McpToolsAdapter {
  list(signal: AbortSignal): Promise<Result<McpToolInfo[], ToolError>>;
  call(input: McpCallInput, ctx: ToolContext): Promise<Result<McpCallOutput, ToolError>>;
}
// Level 2 mapping files, defined in @mete/contracts as AdapterMappingSchema (tab 10, Integration levels).
export type TemplateValue = string | number | boolean | null | TemplateValue[] | { [key: string]: TemplateValue }
  | { each: string; as: TemplateValue };                              // each: one expression naming a list
export type AdapterMapping = { apiVersion: "mete/v1"; kind: "AdapterMapping"; metadata: { id: string; version: string } } & (
  | { type: "mcp"; server: string; implements: Record<CapabilityRef, { tool: string; args?: Record<string, TemplateValue>;
      output: TemplateValue; action?: PolicyAction; features?: string[] }> }   // action defaults to mcp.call
  | { type: "cli" | "http"; implements: Record<CapabilityRef, unknown> });   // not run yet

// vcs.git@2, defined in @mete/contracts; rules in tab 10 (Built-in tools). The model offers the first three operations; the
// rest are the core's. Checkpoint refs are refs/mete/checkpoints/<runId>/<n>, n counting from 1 per run. A task's worktree is
// <global>/worktrees/<runId>/<taskId> on branch mete/<runId>/<taskId>, so no input names a path or a branch.
export type VcsGitInput =
  | { op: "status" }
  | { op: "diff"; staged?: boolean; ref?: string; path?: string }
  | { op: "commit"; message: string; paths?: string[] }     // without paths every change is staged (git add -A)
  | { op: "checkpoint.create"; runId: string }
  | { op: "checkpoint.restore"; ref: string }
  | { op: "checkpoint.prune"; runId: string }                 // core calls it 14 days after the run ends
  | { op: "worktree.create"; runId: string; taskId: string }  // new branch at HEAD; uncommitted changes are not in it
  | { op: "worktree.remove"; runId: string; taskId: string; force?: boolean }   // deletes the branch once merged, or
                                                              // with force also unmerged (Remove a run, ADR-143)
  | { op: "merge"; runId: string; taskId: string; message: string };   // commits the worktree's changes, then merges its branch
export type VcsGitOutput =
  | { op: "status"; branch: string | null; files: { path: string; index: string; worktree: string }[] }
  | { op: "diff"; diff: string }                              // cut like a shell stream
  | { op: "commit"; sha: string }
  | { op: "checkpoint.create"; ref: string; sha: string }
  | { op: "checkpoint.restore"; ref: string }
  | { op: "checkpoint.prune"; removed: number }
  | { op: "worktree.create"; path: string; branch: string; sha: string }
  | { op: "worktree.remove"; removed: boolean }               // false when there was no worktree
  | { op: "merge"; sha: string };                             // the workspace's HEAD after the merge
export type VcsError = ToolError | { code: "nothing_to_commit"; message: string }
  | { code: "merge_conflict"; message: string; paths: string[] };   // the merge was undone
export interface VcsGitAdapter { run(input: VcsGitInput, ctx: ToolContext): Promise<Result<VcsGitOutput, VcsError>> }

// quota.reserve@4, defined in @mete/contracts; QuotaUnit and QuotaUnitSpec are in tab 09, pool rules in tab 09 (Quota pool).
// @3 (ADR-054) adds usage(): the pool read of the quota dashboard (tab 13).
// @4 (ADR-056) adds too_large: every chain entry has a unit whose limit is below the request's amount.
export type QuotaAmounts = Partial<Record<QuotaUnit, number>>;
export type QuotaObservation = { unit: QuotaUnit; limit?: number; remaining?: number; resetsAt?: string; exhausted: boolean };
                                 // a provider's observe() reads response headers and 429s into these
export type QuotaRequest = { runId: string; priority: 0 | 1 | 2;   // P0 interactive, P1 foreground, P2 scheduled
  chain: readonly { providerId: string; modelId: string; estimate?: QuotaAmounts }[];   // @2: an entry's own amounts
  estimate: QuotaAmounts };      // requests default to 1; tokens are prompt tokens plus max_tokens
export type Reservation = { id: string; providerId: string; modelId: string };
export type ReserveFailed = { code: "quota_exhausted"; resumesAt: string } | { code: "aborted" }   // ISO 8601 times
  | { code: "too_large" };       // @4: no entry could ever fit, so waiting would not help
export type UnknownReservation = { code: "unknown_reservation"; id: string };
export type QuotaUsage = { providerId: string; unit: QuotaUnit;
  scope: string | null;          // the model id of a "model" unit; null for "account" or a model unit nothing counted yet
  used: number; limit: number | null;   // null while no limit is known ("discover" before the first exhaustion)
  resetsAt?: string;             // the next reset of a fixed window, or the reset a response gave
  history: readonly { at: string; amount: number }[] };   // the amounts still in the window, oldest first
export interface QuotaReserveAdapter {
  define(specs: readonly QuotaUnitSpec[]): void;
  reserve(req: QuotaRequest, signal: AbortSignal): Promise<Result<Reservation, ReserveFailed>>;
  settle(id: string, actual: QuotaAmounts | null,   // null: no call was sent, release the reservation
    observations: readonly QuotaObservation[]): Result<void, UnknownReservation>;
  usage(): readonly QuotaUsage[];   // @3: one row per defined unit and scope, as they stand now
}

// team.engine@2, defined in @mete/contracts; run states and the runs table in tab 07, single-agent and team rules in tab 08.
// @2 added approve: the human's decision on a task that waits for them (tab 08, Task execution sequence).
// A templateId starts a team run from that template (tab 08): not_found when no folder has it, bad_input when it is
// invalid, not_supported when the composition root gave core-engine no template folders.
// A template file is parsed by TeamTemplateSchema / parseTemplate in @mete/contracts (keys as in YAML, tab 08):
// parseTemplate(input: unknown): Result<TeamTemplate, { code: "invalid_template"; issues: string[] }>.
export type RunStatus = "queued" | "running" | "paused" | "completed" | "failed" | "cancelled";
export type RunStart = { goal?: string; templateId?: string | null; priority?: 0 | 1 | 2;   // priority defaults to 1
  continue?: true };             // take the newest open handoff (tab 08, Run memory); goal is needed unless continue
export type RunView = Omit<Run, "snapshot">;                 // Run in tab 07
export type ApprovalInput = { taskId?: string; decision: "approve" | "revise"; feedback?: string };   // revise needs feedback;
                                 // taskId is the template task id or the Task id; without it, the only task that waits
export type EngineError =
  | { code: "bad_input" | "not_found" | "not_supported"; message: string }
  | { code: "failed"; message: string }                              // remove: git refused; nothing was deleted
  | { code: "invalid_state"; message: string; status: RunStatus }    // the run's status does not allow the call
  | { code: "choose_template"; message: string; suggestions: string[] };   // the router was unsure; no run started
export interface TeamEngineAdapter {
  start(req: RunStart): Promise<Result<{ runId: string }, EngineError>>;   // after run.created and run.started
  pause(runId: string): Promise<Result<void, EngineError>>;    // a running run, reason user; aborts the model call in
                                                               // flight, while a running tool call finishes and is kept
  resume(runId: string): Promise<Result<void, EngineError>>;   // a paused run, from its last saved step
  cancel(runId: string): Promise<Result<void, EngineError>>;   // aborts everything in flight; the kill switch calls it
  approve(runId: string, input: ApprovalInput): Promise<Result<void, EngineError>>;   // a run paused for approval;
                                                               // records the decision, then resumes the run
  status(runId?: string): Result<RunView[], EngineError>;      // one run, or all runs of the workspace, newest first;
                                                               // one run carries prefer, its model choice (ADR-125)
  model?(runId: string, model: ModelRef | null, roleId?: string): Promise<Result<void, EngineError>>;   // ADR-122
  transcript?(runId: string): Promise<Result<Transcript, EngineError>>;   // the steps of its saved conversation, masked (ADR-125)
  remove?(runId: string): Promise<Result<void, EngineError>>;   // an ended run with its worktrees, branches, checkpoints and
                                                               // rows, then run.removed (ADR-143)
}

export interface CapabilityRegistry {
  provide<C>(ref: CapabilityRef, adapter: Adapter<C>): Disposable;
  resolve<C>(ref: CapabilityRef, need?: FeatureSet): Result<AdapterChain<C>, CapabilityMissing>;
  has(ref: CapabilityRef): boolean;
}

export type FeatureSet = readonly string[];  // order and duplicates do not matter
export type Circuit = { isOpen(): boolean };
export type Adapter<C> = { id: string; trust: ModuleManifest["trust"]; features: FeatureSet; impl: C; circuit?: Circuit };
export type AdapterChain<C> = readonly [Adapter<C>, ...Adapter<C>[]];   // never empty
export type CapabilityMissing = { code: "capability_missing"; ref: CapabilityRef };
export type AdapterUnavailable = { code: "adapter_unavailable"; adapterId: string };

export type Disposable = { dispose(): void };
export type Handler<T extends MeteEvent["type"]> = (event: Extract<MeteEvent, { type: T }>) => void;

// Delivery is synchronous, in subscription order. "agent.*" matches whole leading segments
// (agent.tool.called, not agentx.created). A throwing handler goes to the supervisor's error sink
// and the other handlers still run. An event that fails its schema throws (a bug).
export interface EventBus {
  publish<E extends MeteEvent>(event: E): void;
  subscribe<T extends MeteEvent["type"]>(type: T | `${string}.*`, handler: Handler<T>): Disposable;
}
```

## Module lifecycle

`registered` → `resolving` (waiting for `requires`) → `active` → `deactivating` → `inactive`. From `active`, a crash moves the module to `restarting`; after 3 restarts in 5 minutes it moves to `disabled` and publishes `module.disabled` \[D\]. A module whose `requires` never resolves stays `resolving` and the UI shows which capability is missing. A registered module moves to `resolving` when one of its activation events fires: `onStartup` when the composition root starts the kernel; `onWorkspaceOpen` when it opens the workspace (the CLI at once, the desktop when a folder opens); `onCapability:<ref>` when a `resolving` module requires that capability; `onCommand:<id>` when that command runs, once the CLI and desktop command system exists. Until then it stays `registered`. `requires` gates activation only: when a provider later deactivates, its dependents stay active and handle `CapabilityMissing` (Capability resolution, step 5). The kernel re-checks every `resolving` module after each `module.activated`. A module whose `activate` returns an error goes to `inactive` and publishes `module.deactivated` with the error code as reason. Lifecycle events carry `source: "kernel"` and the workspace id the composition root passes when it starts the kernel. The composition root registers storage first, so the events of every later module are persisted. Before the process exits it calls the lifecycle's `stop()`, which deactivates every active module in the reverse order of activation, each as a requested deactivate, and activates nothing after it \[D\].

A crash is an exception thrown by `activate` or `deactivate`, or a `crash(moduleId, error)` call from the composition root (the module's event handler threw on its own bus view, or its child process exited). On a crash the kernel logs the error, publishes `module.crashed` with the error name as reason (never the message, which may hold secrets), moves the module to `restarting`, calls its `deactivate`, releases its disposables and returns it to `resolving` at once, with no delay. A module that already restarted 3 times in the last 5 minutes moves to `disabled` instead, publishes `module.disabled` and stays there until the kernel restarts. An exception from a `deactivate` the composition root asked for is logged and published as `module.crashed`, and the module still ends `inactive`. Lifecycle calls and `loadConfig` run to completion and take no `AbortSignal`; nothing in them is cancellable.

## Capability resolution

1. Collect active adapters for the same capability id and major version.
2. Order them by the binding list: the user's list for that capability (`bindings.yaml` or the `bindings:` settings section), otherwise the built-in list the composition root passes to `loadConfig` \[D\]; adapters not in the binding follow, core before first-party before third-party, then in registration order. One adapter id provides a capability at most once; a second `provide` is a bug and throws.
3. Remove adapters whose circuit is open or that lack a required feature.
4. Return the chain. The caller tries the first adapter; on `AdapterUnavailable` it moves to the next. core-engine's tool calls also move to the next adapter after an `io` failure, each attempt with its own `agent.tool.called` and `agent.tool.completed` events; a write tool (TOOL_CATALOG `write`) never moves on, and `denied`, `approval_required` and `bad_input` end the call \[D\].
5. An empty chain returns `CapabilityMissing`. Callers MUST handle it: degrade, skip with a notice, or pause the run. They MUST NOT crash.

Adapter circuit breaker defaults: open after 5 consecutive failures, half-open after 60 seconds \[D\]. The module that owns an adapter reports each call's success or failure to the adapter's circuit; the registry only reads `isOpen()`. A success closes the circuit; a failure while half-open opens it again for another 60 seconds.

## Module catalog

| Module | Package | Class | Provides | Requires | Optional | Isolation |
| --- | --- | --- | --- | --- | --- | --- |
| storage | `@mete/storage` | essential | `storage.sql@1`, `events.read@1` (ADR-144) | none | none | in-process |
| security | `@mete/security` | essential | `policy.check@1`, `policy.grant@1` (ADR-121), `secrets.mask@1` | `storage.sql@1` | none | in-process |
| quota | `@mete/quota` | essential | `quota.reserve@4` | `storage.sql@1` | none | in-process |
| gateway | `@mete/gateway` | essential | `llm.chat@2` (routed), `llm.embed@1` (routed, ADR-152), `llm.rerank@1` (routed, not yet, ADR-152) | `storage.sql@1`, `quota.reserve@4`, `secrets.mask@1`, at least one `provider.chat@2` | `provider.embed@2`, `provider.rerank@1` | in-process |
| provider-nvidia | `@mete/providers` | optional | `provider.chat@2`, `provider.embed@2`, `provider.rerank@1` | none | none | in-process |
| provider-openrouter | `@mete/providers` | optional | `provider.chat@2` | none | none | in-process |
| provider-opencode-zen | `@mete/providers` | optional | `provider.chat@2` | none | none | in-process |
| provider-groq | `@mete/providers` | optional | `provider.chat@2` | none | none | in-process |
| provider-google | `@mete/providers` | optional | `provider.chat@2` | none | none | in-process |
| provider-custom | `@mete/providers` | optional | `provider.chat@2`, `provider.embed@2` when the format supports it | none | none | in-process |
| tools-fs | `@mete/tools` | essential | `fs.read@1`, `fs.write@1`, `fs.edit@1`, `fs.list@1`, `fs.glob@1`, `fs.grep@1` | `policy.check@1` | none | in-process |
| tools-shell | `@mete/tools` | essential | `shell.exec@1` | `policy.check@1` | none | in-process |
| tools-web | `@mete/tools` | optional | `web.fetch@1`, `web.search@1` (HTTP adapters) | `policy.check@1` | `mcp.tools@1` | in-process |
| vcs-git | `@mete/tools` | optional | `vcs.git@2` | `policy.check@1` | none | in-process |
| mcp-client | `@mete/mcp` | optional | `mcp.tools@1`, `runtime.ensure@1`, mapping adapters for any capability | `policy.check@1` | `registry.search@1`, `llm.chat@2`, `shell.exec@1` (cli mappings, ADR-120) | in-process; servers in child processes |
| mcp-server | `@mete/mcp` | optional | METE as an MCP server | `team.engine@2` | `knowledge.search@1` | in-process |
| registry | `@mete/mcp` | optional | `registry.search@1` | `policy.check@1` | none | in-process |
| knowledge-graph | `@mete/knowledge` | optional | `code.graph@1` | `fs.read@1` | `llm.chat@2` | worker |
| vault | `@mete/knowledge` | optional | `vault.read@1`, `vault.write@1` | `fs.read@1`, `fs.write@1`, `events.read@1` (ADR-144) | none | in-process |
| knowledge-search | `@mete/knowledge` | optional | `knowledge.search@1`, `knowledge.index@1` (not yet, ADR-149) | `storage.sql@1`, `fs.glob@1`, `fs.read@1` (ADR-149) | `llm.embed@1`, `llm.rerank@1`, `code.graph@1`, `vault.read@1` | in-process while it indexes the vault's notes and, in the background, embeds them (ADR-152); a worker for code index jobs (ADR-149) |
| core-engine | `@mete/core` | essential | `team.engine@2` (native), `checkpoint.restore@1`, runs, router, artifacts, checkpoints | `llm.chat@2`, `fs.*`, `policy.check@1`, `secrets.mask@1`, `storage.sql@1` | `shell.exec@1`, `vcs.git@2`, `web.fetch@1`, `web.search@1`, `mcp.tools@1`, `knowledge.search@1`, `vault.*` | in-process |
| autonomy | `@mete/core` | optional | triggers, schedules | `team.engine@2` | `issues.source@1` | in-process |
| browser | `@mete/tools` | optional | `browser.screenshot@2`, `seo.audit@2` | `policy.check@1` | none | in-process; each call in a child process; Chromium comes from Playwright's own installer, not `runtime.ensure@1` (tab 10) \[D\] |
| engine-crewai, engine-metagpt, engine-chatdev | `@mete/engines` | optional | `team.engine@2` | `runtime.ensure@1`, `llm.chat@2` | none | process |
| ui-board, ui-flow, ui-studio, ui-replay | `@mete/ui-*` | optional | UI views (subscribe to events) | none | none | renderer |

Until a second view needs it as a module, the run view model these views share is a library in `@mete/ui-studio` (a fold over a run's events, depending only on `@mete/contracts`), and the Board is a widget of `@mete/ui-theia` (ADR-051). The Studio stage lives in `@mete/ui-studio` and loads `pixi.js` lazily, so the fold never loads it (ADR-052) \[D\].

The gateway provides `llm.chat@2` and `llm.embed@1` (ADR-152): `listModels` answers a provider's chat models and `embedModels` (`provider.embed@2`) its embedding models. `llm.rerank@1` and the `/v1/embeddings` and `/v1/rerank` endpoints come with a caller that needs them, and the rerank chain is empty until then \[D\].

The essential set is: kernel, storage, security, quota, gateway, tools-fs, tools-shell, core-engine, plus at least one active `provider.chat@2` adapter. The UI MUST NOT allow uninstalling essential modules; it MAY show them as "built in".

## Capability catalog

| Capability | Purpose | Default adapters, in fallback order | When the chain is empty |
| --- | --- | --- | --- |
| `storage.sql@1` | The workspace and global SQLite databases, with per-module migrations | Native (storage module) | Never empty (essential) |
| `events.read@1` | One run's persisted catalog events in `seq` order, and the rows that no longer parse (ADR-144) | Native (storage module) | Never empty (essential) |
| `policy.check@1` | Allow, ask or deny a side-effect action, and write its audit row | Native (security module) | Never empty (essential) |
| `policy.grant@1` | Let a run do what the policy asked about, once or for the rest of the run (ADR-121) | Native (security module) | Never empty (essential) |
| `secrets.mask@1` | Replace secrets in outbound text | Native (security module, secretlint) | Never empty (essential) |
| `quota.reserve@4` | Reserve and settle provider quota for a model call, and read the pool | Native (quota module) | Never empty (essential) |
| `llm.chat@2` | Chat with tools and streaming | Gateway → tier chain of discovered models the model mode allows (free by default, ADR-042) | Run pauses with reason `quota` or `no_model` |
| `llm.embed@1` | Embeddings | NVIDIA embedding model | Vector search off; hybrid search continues |
| `llm.rerank@1` | Reranking | NVIDIA rerank model | Rerank skipped |
| `fs.*@1` | Files: read, write, edit, list, glob, grep | Native | Never empty (essential) |
| `shell.exec@1` | Run commands under policy | Native (child process) | Never empty (essential) |
| `web.fetch@1` | Page to clean Markdown | Native reader | Steps needing it are blocked with a notice |
| `web.search@1` | Web search returning URLs | Exa MCP (no key) → Tavily → Exa API → You.com → Firecrawl | Steps needing it are blocked with a notice |
| `vcs.git@2` | Status, diff, worktrees, checkpoints | simple-git | Core uses file snapshots |
| `checkpoint.restore@1` | Restore a run's git checkpoint or file snapshot, recording the current state first (ADR-079, ADR-080) | Native (core-engine) | A git ref without `vcs.git@2` answers `no_vcs`; snapshots need no adapter |
| `code.graph@1` | Query code structure | tree-sitter graph; Graphify through MCP as an alternative | `knowledge.search@1` works without it |
| `knowledge.search@1` | Hybrid search | knowledge-search module | Plain ripgrep search |
| `vault.read@1`, `vault.write@1` | Notes and lessons | vault module | Lessons are not saved; runs continue |
| `team.engine@2` | Execute a team template | Native XState engine; optional CrewAI, MetaGPT, ChatDev | Never empty (essential) |
| `media.image.generate@1`, `media.image.edit@1` | Images | MCP mapping adapters (for example an NVIDIA NIM MCP server with FLUX, Hugging Face Spaces) | Artist writes specs and placeholders |
| `media.3d.fromText@1`, `media.3d.fromImage@1` | 3D assets | MCP mapping adapters (for example TRELLIS) | Artist writes specs and placeholders |
| `3d.cleanup@1`, `3d.export@1` | Mesh cleanup and export | MCP or CLI adapters (Blender, 3ds Max, others) | Raw generated file is kept |
| `gameengine.build@1`, `gameengine.test@1`, `gameengine.importAsset@1` | Engine actions | MCP or CLI adapters (Unity, Unreal, Godot, others) | Tester verifies by code review only and marks the gap |
| `browser.screenshot@2`, `seo.audit@2` | Visual checks and audits | Playwright, Lighthouse | Steps needing them are blocked with a notice |
| `registry.search@1` | Find plugins, MCP servers, skills, templates | Official MCP registry → METE registry repository → local folder | Manual install only |
| `issues.source@1` | Issues that trigger runs | GitHub | Issue triggers off |
| `release.publish@1` | Publish builds | GitHub Releases | Manual upload |
| `runtime.ensure@1` | Node.js, Python (uv), binaries; containers only if present | Runtime manager | MCP servers needing it stay inactive |
