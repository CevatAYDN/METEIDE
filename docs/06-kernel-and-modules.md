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
  | "net.fetch" | "plugin.install" | "mcp.install" | "mcp.sampling" | "runtime.install" | "release.publish" | "vault.write.personal";
export type PolicyCheckInput = { action: PolicyAction; capability: CapabilityRef; adapterId: string; args: unknown;   // args are hashed into the audit log
  runId?: string; agentId?: string; path?: string; command?: string; tainted?: boolean };
export type PolicyVerdict = { verdict: "allow" | "ask" | "deny"; rule: string };   // rule names the step that fired
export type AuditFailed = { code: "audit_failed"; message: string };            // callers treat it as deny
export interface PolicyCheckAdapter { check(input: PolicyCheckInput): Result<PolicyVerdict, AuditFailed> }
export interface SecretsMaskAdapter { mask(text: string): Promise<{ text: string; masked: number }> }   // tab 09 replacement format

// provider.chat@2, provider.embed@1 and provider.rerank@1, defined in @mete/contracts; ProviderAdapter and ModelInfo
// are in tab 09. Each provider module provides one adapter object under every ref it supports.
// provider.chat@2 (ADR-042) adds the optional ModelInfo.price = { input, output }, US dollars per million tokens, for paid
// models; quota.reserve@2 adds the unit usd_per_day.
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

// llm.chat@1, defined in @mete/contracts: the gateway's routed chat (tab 09, Gateway). The caller names a tier
// or one exact model; the gateway resolves the chain, reserves quota and moves down the chain on failures.
export type Tier = "reasoning" | "coder" | "fast" | "long-context" | "vision";
export type ModelRef = { providerId: string; modelId: string };
export type LlmChatRequest = Omit<ChatRequest, "model"> & {
  target: { tier: Tier } | ModelRef;
  runId: string; priority: 0 | 1 | 2;                       // as in QuotaRequest
  needs?: ("tool_calling" | "vision" | "long_context")[];   // the role's needs (tab 08)
  avoidFamilies?: string[] };                               // families of the roles in prefer_different_family_than
export type LlmError = ProviderError | { code: "no_model"; message: string }
  | { code: "quota_exhausted"; message: string; resumesAt: string };   // run pause reasons no_model and quota
export type LlmChunk =
  | Exclude<ChatChunk, { type: "error" }>
  | { type: "model"; providerId: string; modelId: string; reason: "first" | "quota" | "failed" }
  | { type: "error"; error: LlmError };                    // the last chunk; chat never throws for a model failure
export interface LlmChatAdapter {
  chat(req: LlmChatRequest, signal: AbortSignal): AsyncIterable<LlmChunk>;
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
export type ToolContext = { runId?: string; agentId?: string; tainted?: boolean; signal: AbortSignal };   // passed on to policy.check@1
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

// vcs.git@1, defined in @mete/contracts; rules in tab 10 (Built-in tools). Worktree and merge operations come with the
// team engine (Phase 2). Checkpoint refs are refs/mete/checkpoints/<runId>/<n>, n counting from 1 per run.
export type VcsGitInput =
  | { op: "status" }
  | { op: "diff"; staged?: boolean; ref?: string; path?: string }
  | { op: "commit"; message: string; paths?: string[] }     // without paths every change is staged (git add -A)
  | { op: "checkpoint.create"; runId: string }
  | { op: "checkpoint.restore"; ref: string }
  | { op: "checkpoint.prune"; runId: string };                // core calls it 14 days after the run ends
export type VcsGitOutput =
  | { op: "status"; branch: string | null; files: { path: string; index: string; worktree: string }[] }
  | { op: "diff"; diff: string }                              // cut like a shell stream
  | { op: "commit"; sha: string }
  | { op: "checkpoint.create"; ref: string; sha: string }
  | { op: "checkpoint.restore"; ref: string }
  | { op: "checkpoint.prune"; removed: number };
export type VcsError = ToolError | { code: "nothing_to_commit"; message: string };
export interface VcsGitAdapter { run(input: VcsGitInput, ctx: ToolContext): Promise<Result<VcsGitOutput, VcsError>> }

// quota.reserve@2, defined in @mete/contracts; QuotaUnit and QuotaUnitSpec are in tab 09, pool rules in tab 09 (Quota pool).
export type QuotaAmounts = Partial<Record<QuotaUnit, number>>;
export type QuotaObservation = { unit: QuotaUnit; limit?: number; remaining?: number; resetsAt?: string; exhausted: boolean };
                                 // a provider's observe() reads response headers and 429s into these
export type QuotaRequest = { runId: string; priority: 0 | 1 | 2;   // P0 interactive, P1 foreground, P2 scheduled
  chain: readonly { providerId: string; modelId: string; estimate?: QuotaAmounts }[];   // @2: an entry's own amounts
  estimate: QuotaAmounts };      // requests default to 1; tokens are prompt tokens plus max_tokens
export type Reservation = { id: string; providerId: string; modelId: string };
export type ReserveFailed = { code: "quota_exhausted"; resumesAt: string } | { code: "aborted" };   // ISO 8601 times
export type UnknownReservation = { code: "unknown_reservation"; id: string };
export interface QuotaReserveAdapter {
  define(specs: readonly QuotaUnitSpec[]): void;
  reserve(req: QuotaRequest, signal: AbortSignal): Promise<Result<Reservation, ReserveFailed>>;
  settle(id: string, actual: QuotaAmounts | null,   // null: no call was sent, release the reservation
    observations: readonly QuotaObservation[]): Result<void, UnknownReservation>;
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
  status(runId?: string): Result<RunView[], EngineError>;      // one run, or all runs of the workspace, newest first
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
2. Order them by the workspace binding list; adapters not in the binding follow, core before first-party before third-party, then in registration order. One adapter id provides a capability at most once; a second `provide` is a bug and throws.
3. Remove adapters whose circuit is open or that lack a required feature.
4. Return the chain. The caller tries the first adapter; on `AdapterUnavailable` it moves to the next.
5. An empty chain returns `CapabilityMissing`. Callers MUST handle it: degrade, skip with a notice, or pause the run. They MUST NOT crash.

Adapter circuit breaker defaults: open after 5 consecutive failures, half-open after 60 seconds \[D\]. The module that owns an adapter reports each call's success or failure to the adapter's circuit; the registry only reads `isOpen()`. A success closes the circuit; a failure while half-open opens it again for another 60 seconds.

## Module catalog

| Module | Package | Class | Provides | Requires | Optional | Isolation |
| --- | --- | --- | --- | --- | --- | --- |
| storage | `@mete/storage` | essential | `storage.sql@1` | none | none | in-process |
| security | `@mete/security` | essential | `policy.check@1`, `secrets.mask@1` | `storage.sql@1` | none | in-process |
| quota | `@mete/quota` | essential | `quota.reserve@2` | `storage.sql@1` | none | in-process |
| gateway | `@mete/gateway` | essential | `llm.chat@1` (routed), `llm.embed@1` (routed), `llm.rerank@1` (routed) | `storage.sql@1`, `quota.reserve@2`, `secrets.mask@1`, at least one `provider.chat@2` | `provider.embed@1`, `provider.rerank@1` | in-process |
| provider-nvidia | `@mete/providers` | optional | `provider.chat@2`, `provider.embed@1`, `provider.rerank@1` | none | none | in-process |
| provider-openrouter | `@mete/providers` | optional | `provider.chat@2` | none | none | in-process |
| provider-opencode-zen | `@mete/providers` | optional | `provider.chat@2` | none | none | in-process |
| provider-custom | `@mete/providers` | optional | `provider.chat@2`, `provider.embed@1` when the format supports it | none | none | in-process |
| tools-fs | `@mete/tools` | essential | `fs.read@1`, `fs.write@1`, `fs.edit@1`, `fs.list@1`, `fs.glob@1`, `fs.grep@1` | `policy.check@1` | none | in-process |
| tools-shell | `@mete/tools` | essential | `shell.exec@1` | `policy.check@1` | none | in-process |
| tools-web | `@mete/tools` | optional | `web.fetch@1`, `web.search@1` (HTTP adapters) | `policy.check@1` | `mcp.tools@1` | in-process |
| vcs-git | `@mete/tools` | optional | `vcs.git@1` | `policy.check@1` | none | in-process |
| mcp-client | `@mete/mcp` | optional | `mcp.tools@1`, `runtime.ensure@1`, mapping adapters for any capability | `policy.check@1` | `registry.search@1` | in-process; servers in child processes |
| mcp-server | `@mete/mcp` | optional | METE as an MCP server | `team.engine@2` | `knowledge.search@1` | in-process |
| registry | `@mete/mcp` | optional | `registry.search@1` | `web.fetch@1` | none | in-process |
| knowledge-graph | `@mete/knowledge` | optional | `code.graph@1` | `fs.read@1` | `llm.chat@1` | worker |
| vault | `@mete/knowledge` | optional | `vault.read@1`, `vault.write@1` | `fs.read@1`, `fs.write@1` | none | in-process |
| knowledge-search | `@mete/knowledge` | optional | `knowledge.search@1`, `knowledge.index@1` | `fs.grep@1` | `llm.embed@1`, `llm.rerank@1`, `code.graph@1`, `vault.read@1` | worker |
| core-engine | `@mete/core` | essential | `team.engine@2` (native), runs, router, artifacts, checkpoints | `llm.chat@1`, `fs.*`, `policy.check@1`, `secrets.mask@1`, `storage.sql@1` | `shell.exec@1`, `vcs.git@1`, `web.fetch@1`, `web.search@1`, `knowledge.search@1`, `vault.*` | in-process |
| autonomy | `@mete/core` | optional | triggers, schedules | `team.engine@2` | `issues.source@1` | in-process |
| browser | `@mete/tools` | optional | `browser.screenshot@1`, `seo.audit@1` | `runtime.ensure@1` | none | process |
| engine-crewai, engine-metagpt, engine-chatdev | `@mete/engines` | optional | `team.engine@2` | `runtime.ensure@1`, `llm.chat@1` | none | process |
| ui-board, ui-flow, ui-studio, ui-replay | `@mete/ui-*` | optional | UI views (subscribe to events) | none | none | renderer |

Until the knowledge layer, the gateway provides only `llm.chat@1`: no provider adapter lists its embedding or rerank models (`listModels` returns chat models), so `llm.embed@1`, `llm.rerank@1` and their gateway endpoints come with the knowledge layer, and their chains are empty until then \[D\].

The essential set is: kernel, storage, security, quota, gateway, tools-fs, tools-shell, core-engine, plus at least one active `provider.chat@2` adapter. The UI MUST NOT allow uninstalling essential modules; it MAY show them as "built in".

## Capability catalog

| Capability | Purpose | Default adapters, in fallback order | When the chain is empty |
| --- | --- | --- | --- |
| `storage.sql@1` | The workspace and global SQLite databases, with per-module migrations | Native (storage module) | Never empty (essential) |
| `policy.check@1` | Allow, ask or deny a side-effect action, and write its audit row | Native (security module) | Never empty (essential) |
| `secrets.mask@1` | Replace secrets in outbound text | Native (security module, secretlint) | Never empty (essential) |
| `quota.reserve@2` | Reserve and settle provider quota for a model call | Native (quota module) | Never empty (essential) |
| `llm.chat@1` | Chat with tools and streaming | Gateway → tier chain of discovered models the model mode allows (free by default, ADR-042) | Run pauses with reason `quota` or `no_model` |
| `llm.embed@1` | Embeddings | NVIDIA embedding model | Vector search off; hybrid search continues |
| `llm.rerank@1` | Reranking | NVIDIA rerank model | Rerank skipped |
| `fs.*@1` | Files: read, write, edit, list, glob, grep | Native | Never empty (essential) |
| `shell.exec@1` | Run commands under policy | Native (child process) | Never empty (essential) |
| `web.fetch@1` | Page to clean Markdown | Native reader | Steps needing it are blocked with a notice |
| `web.search@1` | Web search returning URLs | Exa MCP (no key) → Tavily → Exa API → You.com → Firecrawl | Steps needing it are blocked with a notice |
| `vcs.git@1` | Status, diff, worktrees, checkpoints | simple-git | Core uses file snapshots |
| `code.graph@1` | Query code structure | tree-sitter graph; Graphify through MCP as an alternative | `knowledge.search@1` works without it |
| `knowledge.search@1` | Hybrid search | knowledge-search module | Plain ripgrep search |
| `vault.read@1`, `vault.write@1` | Notes and lessons | vault module | Lessons are not saved; runs continue |
| `team.engine@2` | Execute a team template | Native XState engine; optional CrewAI, MetaGPT, ChatDev | Never empty (essential) |
| `media.image.generate@1`, `media.image.edit@1` | Images | MCP mapping adapters (for example an NVIDIA NIM MCP server with FLUX, Hugging Face Spaces) | Artist writes specs and placeholders |
| `media.3d.fromText@1`, `media.3d.fromImage@1` | 3D assets | MCP mapping adapters (for example TRELLIS) | Artist writes specs and placeholders |
| `3d.cleanup@1`, `3d.export@1` | Mesh cleanup and export | MCP or CLI adapters (Blender, 3ds Max, others) | Raw generated file is kept |
| `gameengine.build@1`, `gameengine.test@1`, `gameengine.importAsset@1` | Engine actions | MCP or CLI adapters (Unity, Unreal, Godot, others) | Tester verifies by code review only and marks the gap |
| `browser.screenshot@1`, `seo.audit@1` | Visual checks and audits | Playwright, Lighthouse | Steps needing them are blocked with a notice |
| `registry.search@1` | Find plugins, MCP servers, skills, templates | Official MCP registry → METE registry repository → local folder | Manual install only |
| `issues.source@1` | Issues that trigger runs | GitHub | Issue triggers off |
| `release.publish@1` | Publish builds | GitHub Releases | Manual upload |
| `runtime.ensure@1` | Node.js, Python (uv), binaries; containers only if present | Runtime manager | MCP servers needing it stay inactive |
