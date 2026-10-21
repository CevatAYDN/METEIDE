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

`registered` → `resolving` (waiting for `requires`) → `active` → `deactivating` → `inactive`. From `active`, a crash moves the module to `restarting`; after 3 restarts in 5 minutes it moves to `disabled` and publishes `module.disabled` \[D\]. A module whose `requires` never resolves stays `resolving` and the UI shows which capability is missing. A registered module moves to `resolving` when one of its activation events fires: `onStartup` when the composition root starts the kernel; `onWorkspaceOpen` when it opens the workspace (the CLI at once, the desktop when a folder opens); `onCapability:<ref>` when a `resolving` module requires that capability; `onCommand:<id>` when that command runs, once the CLI and desktop command system exists. Until then it stays `registered`. `requires` gates activation only: when a provider later deactivates, its dependents stay active and handle `CapabilityMissing` (Capability resolution, step 5). The kernel re-checks every `resolving` module after each `module.activated`. A module whose `activate` returns an error goes to `inactive` and publishes `module.deactivated` with the error code as reason. Lifecycle events carry `source: "kernel"` and the workspace id the composition root passes when it starts the kernel.

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
| quota | `@mete/quota` | essential | `quota.reserve@1` | `storage.sql@1` | none | in-process |
| gateway | `@mete/gateway` | essential | `llm.chat@1` (routed), `llm.embed@1` (routed), `llm.rerank@1` (routed) | `quota.reserve@1`, `secrets.mask@1`, at least one `provider.chat@1` | `provider.embed@1`, `provider.rerank@1` | in-process |
| provider-nvidia | `@mete/providers` | optional | `provider.chat@1`, `provider.embed@1`, `provider.rerank@1` | none | none | in-process |
| provider-openrouter | `@mete/providers` | optional | `provider.chat@1` | none | none | in-process |
| provider-opencode-zen | `@mete/providers` | optional | `provider.chat@1` | none | none | in-process |
| provider-custom | `@mete/providers` | optional | `provider.chat@1`, `provider.embed@1` when the format supports it | none | none | in-process |
| tools-fs | `@mete/tools` | essential | `fs.read@1`, `fs.write@1`, `fs.edit@1`, `fs.list@1`, `fs.glob@1`, `fs.grep@1` | `policy.check@1` | none | in-process |
| tools-shell | `@mete/tools` | essential | `shell.exec@1` | `policy.check@1` | none | in-process |
| tools-web | `@mete/tools` | optional | `web.fetch@1`, `web.search@1` (HTTP adapters) | `policy.check@1` | `mcp.tools@1` | in-process |
| vcs-git | `@mete/tools` | optional | `vcs.git@1` | `shell.exec@1` | none | in-process |
| mcp-client | `@mete/mcp` | optional | `mcp.tools@1`, `runtime.ensure@1`, mapping adapters for any capability | `policy.check@1` | `registry.search@1` | in-process; servers in child processes |
| mcp-server | `@mete/mcp` | optional | METE as an MCP server | `team.engine@1` | `knowledge.search@1` | in-process |
| registry | `@mete/mcp` | optional | `registry.search@1` | `web.fetch@1` | none | in-process |
| knowledge-graph | `@mete/knowledge` | optional | `code.graph@1` | `fs.read@1` | `llm.chat@1` | worker |
| vault | `@mete/knowledge` | optional | `vault.read@1`, `vault.write@1` | `fs.read@1`, `fs.write@1` | none | in-process |
| knowledge-search | `@mete/knowledge` | optional | `knowledge.search@1`, `knowledge.index@1` | `fs.grep@1` | `llm.embed@1`, `llm.rerank@1`, `code.graph@1`, `vault.read@1` | worker |
| core-engine | `@mete/core` | essential | `team.engine@1` (native), runs, router, artifacts, checkpoints | `llm.chat@1`, `fs.*`, `policy.check@1` | `vcs.git@1`, `knowledge.search@1`, `vault.*` | in-process |
| autonomy | `@mete/core` | optional | triggers, schedules | `team.engine@1` | `issues.source@1` | in-process |
| browser | `@mete/tools` | optional | `browser.screenshot@1`, `seo.audit@1` | `runtime.ensure@1` | none | process |
| engine-crewai, engine-metagpt, engine-chatdev | `@mete/engines` | optional | `team.engine@1` | `runtime.ensure@1`, `llm.chat@1` | none | process |
| ui-board, ui-flow, ui-studio, ui-replay | `@mete/ui-*` | optional | UI views (subscribe to events) | none | none | renderer |

The essential set is: kernel, storage, security, quota, gateway, tools-fs, tools-shell, core-engine, plus at least one active `provider.chat@1` adapter. The UI MUST NOT allow uninstalling essential modules; it MAY show them as "built in".

## Capability catalog

| Capability | Purpose | Default adapters, in fallback order | When the chain is empty |
| --- | --- | --- | --- |
| `llm.chat@1` | Chat with tools and streaming | Gateway → tier chain of discovered free models | Run pauses with reason `quota` or `no_model` |
| `llm.embed@1` | Embeddings | NVIDIA embedding model | Vector search off; hybrid search continues |
| `llm.rerank@1` | Reranking | NVIDIA rerank model | Rerank skipped |
| `fs.*@1` | Files: read, write, edit, list, glob, grep | Native | Never empty (essential) |
| `shell.exec@1` | Run commands under policy | Native PTY | Never empty (essential) |
| `web.fetch@1` | Page to clean Markdown | Native reader | Steps needing it are blocked with a notice |
| `web.search@1` | Web search returning URLs | Exa MCP (no key) → Tavily → Exa API → You.com → Firecrawl | Steps needing it are blocked with a notice |
| `vcs.git@1` | Status, diff, worktrees, checkpoints | simple-git | Core uses file snapshots |
| `code.graph@1` | Query code structure | tree-sitter graph; Graphify through MCP as an alternative | `knowledge.search@1` works without it |
| `knowledge.search@1` | Hybrid search | knowledge-search module | Plain ripgrep search |
| `vault.read@1`, `vault.write@1` | Notes and lessons | vault module | Lessons are not saved; runs continue |
| `team.engine@1` | Execute a team template | Native XState engine; optional CrewAI, MetaGPT, ChatDev | Never empty (essential) |
| `media.image.generate@1`, `media.image.edit@1` | Images | MCP mapping adapters (for example an NVIDIA NIM MCP server with FLUX, Hugging Face Spaces) | Artist writes specs and placeholders |
| `media.3d.fromText@1`, `media.3d.fromImage@1` | 3D assets | MCP mapping adapters (for example TRELLIS) | Artist writes specs and placeholders |
| `3d.cleanup@1`, `3d.export@1` | Mesh cleanup and export | MCP or CLI adapters (Blender, 3ds Max, others) | Raw generated file is kept |
| `gameengine.build@1`, `gameengine.test@1`, `gameengine.importAsset@1` | Engine actions | MCP or CLI adapters (Unity, Unreal, Godot, others) | Tester verifies by code review only and marks the gap |
| `browser.screenshot@1`, `seo.audit@1` | Visual checks and audits | Playwright, Lighthouse | Steps needing them are blocked with a notice |
| `registry.search@1` | Find plugins, MCP servers, skills, templates | Official MCP registry → METE registry repository → local folder | Manual install only |
| `issues.source@1` | Issues that trigger runs | GitHub | Issue triggers off |
| `release.publish@1` | Publish builds | GitHub Releases | Manual upload |
| `runtime.ensure@1` | Node.js, Python (uv), binaries; containers only if present | Runtime manager | MCP servers needing it stay inactive |
