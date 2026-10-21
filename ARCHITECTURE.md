# 03 Architecture

Repository file: `ARCHITECTURE.md`. Depends on: 02 Glossary.

METE is a microkernel. A small kernel loads modules; modules talk to each other only through capability contracts and events, never through each other's code \[C\].

## Layers

```
6  Interfaces      apps/cli (mete)  |  apps/desktop (Theia + Electron)  |  ui-studio, ui-kit
5  Orchestration   core (native team engine, runs, tasks, artifacts, router, autonomy, triggers)
4  Capabilities    providers | tools | mcp | knowledge | engines (optional Python adapters)
3  Platform        storage | security | quota | gateway
2  Contracts       contracts (capability schemas, event schemas, artifact schemas)
1  Kernel          kernel (module loader, capability registry, event bus, config, lifecycle, supervisor)
```

Dependency rules, enforced by dependency-cruiser in local CI \[C\]:

- A package MUST import only from its own layer's contracts or from lower layers.
- A package MUST import other packages only through their public `index.ts`.
- A capability module MUST NOT import another capability module. It resolves the capability through the kernel registry.
- `contracts` MUST NOT import any METE package. `kernel` MUST import only `contracts` (ADR-036).

## Process model

```
Electron main process
  ├─ Theia backend (Node)  ◄── JSON-RPC over stdio ──►  METE core daemon (Node, ELECTRON_RUN_AS_NODE=1)
  │                                                        ├─ kernel + core and first-party modules (in process)
  │                                                        ├─ worker threads: tree-sitter, indexing, embedding batches
  │                                                        ├─ child process per third-party plugin
  │                                                        ├─ child process per MCP server (stdio) on a managed runtime
  │                                                        ├─ child process per optional engine adapter (Python via uv)
  │                                                        └─ gateway: Hono on 127.0.0.1:<random free port>
  └─ Theia frontend (renderer): React panels, Monaco, xterm.js, studio view (PixiJS)

CLI `mete`: loads the same kernel and modules in its own Node process, without Theia
```

- The core runs as a separate daemon so a crash in agent work never takes the editor down \[D\].
- The desktop backend talks to the daemon with `vscode-jsonrpc` over stdio. Events stream to the UI as JSON-RPC notifications \[C\].
- The gateway accepts connections only from 127.0.0.1 and requires a per-session bearer token generated at daemon start \[D\].
- Modules with `trust: third-party` MUST run in a child process. Core and first-party modules MAY run in process \[C\].

## Failure handling

- The kernel supervisor restarts a crashed child process. Default: at most 3 restarts in 5 minutes; then the circuit opens, the module is disabled, `module.disabled` is published and the user sees a calm notice \[D\].
- When a capability loses its provider, the registry resolves the next adapter in the fallback chain. Every capability defines what happens when its chain is empty (06 Kernel and modules); for example, plain grep serves `knowledge.search@1` \[C\].
- When the daemon crashes, the desktop restarts it. Runs resume from their persisted XState snapshots \[C\].
- Network loss pauses runs (`run.paused`, reason `network`) and resumes them when the connection returns \[C\].

## Data locations

| What | Where |
| --- | --- |
| Global data | Windows `%APPDATA%\METE\`; Linux `$XDG_DATA_HOME/mete` (default `~/.local/share/mete`); macOS later `~/Library/Application Support/METE` \[D\] |
| Global contents | `mete.db` (SQLite), `runtimes/`, `plugins/`, `logs/`, `worktrees/`, `snapshots/`, `cache/` \[D\] |
| Personal vault | Chosen at onboarding; default `Documents/METE Vault` \[D\] |
| Workspace files | `.mete/workspace.yaml`, `bindings.yaml`, `policy.yaml`, `teams/`, `knowledge/`, `artifacts/`, `assets/`, mcp.yaml, skills/, `mete.db` \[D\] |
| Committed to git | Everything in `.mete/` except `mete.db*`, `cache/` and `worktrees/`; METE writes a `.mete/.gitignore` for these \[D\] |
| Secrets | Operating system keychain only (Electron `safeStorage`, `@napi-rs/keyring`) \[C\] |

## Main flows

1. Start a run: user or trigger → router (single agent or team template) → team engine creates the run and its tasks → `run.started`.
2. Model call: agent → `llm.chat@1` → quota scheduler reserves capacity → privacy filter and secret masking → gateway → provider adapter → response → quota recorded → `quota.consumed`.
3. Tool call: agent → capability resolved through the workspace binding → policy check → adapter (in process, MCP, CLI or HTTP) → result → `agent.tool.completed`.
4. Knowledge query: `knowledge.search@1` → workspace vault and code graph first, personal vault second → fused ranking.
5. Module removal: `deactivate()` disposes its resources → registry drops its providers → callers resolve the next adapter.

## Configuration

YAML files validated by Zod. Precedence, lowest to highest: built-in defaults → global settings → workspace `.mete/*.yaml` → run options \[D\]. Invalid configuration is rejected with the file, path and reason; METE MUST NOT start a run on invalid configuration.

Global settings live in `settings.yaml` in the global data folder; its top-level sections use the workspace file names (`mcp:`, `policy:`). `ConfigReader.get(key)` takes a file name without extension (`bindings`, `mcp`): the workspace file is deep-merged over the global section of the same name (objects merge, arrays and scalars replace), and the module's Zod schema supplies the built-in defaults. The core merges run options when a run starts. At load the kernel checks YAML syntax and its own files (`workspace.yaml` `id`, `bindings.yaml`); a module's section is validated when it calls `get()`, and the error names the file the bad value came from. When `.mete/workspace.yaml` is missing, the loader creates it with a new UUID `id`.

## Repository layout

```
mete/
  apps/
    desktop/         Theia + Electron application
    cli/             headless runner, binary `mete`
  packages/
    kernel/          module loader, capability registry, event bus, config, supervisor
    contracts/       Zod schemas: capabilities, events, artifacts, templates, policy
    storage/         SQLite access (better-sqlite3 + Drizzle), migrations
    security/        policy engine, permissions, secret masking, audit log
    quota/           multi-unit quota pool and scheduler
    gateway/         local OpenAI-compatible gateway (Hono)
    providers/       provider adapter base + nvidia, openrouter, opencode-zen, custom
    tools/           fs, edit, grep, glob, shell, web fetch, web search chain
    mcp/             MCP client and server, runtime manager, registry adapters
    knowledge/       code graph, vault, hybrid search
    core/            native team engine (XState), router, artifacts, autonomy, triggers
    engines/         optional adapters: crewai, metagpt, chatdev (Python via uv)
    ui-kit/          design tokens and shared React components
    ui-studio/       studio view (PixiJS)
    testing/         contract test kits, MSW fixtures, helpers
  templates/         research, seo-audit, web-dev, game-studio
  adapters/          declarative adapter mappings (YAML)
  docs/              these documents and ADRs
  AGENTS.md  ARCHITECTURE.md  CONTRIBUTING.md  THIRD_PARTY_NOTICES.md  LICENSE
```
