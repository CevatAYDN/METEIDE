# 03 Architecture

Repository file: `ARCHITECTURE.md`. Depends on: 02 Glossary.

METE is a microkernel. A small kernel loads modules; modules talk to each other only through capability contracts and events, never through each other's code \[C\].

## Layers

```
6  Interfaces      apps/cli (mete)  |  apps/desktop (Theia + Electron)  |  ui-theia, ui-studio, ui-kit
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
- `apps/desktop` and `ui-theia` MUST import no METE package below layer 6 other than `contracts`; they reach the core through the daemon (ADR-045), and they name `@mete/cli` only to find the daemon's `mete` entry file. Of layer 6, `ui-theia` may import `ui-studio`, the library that folds a run's events into its view model (ADR-051). Only they import `@theia/*` \[D\].

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
- The daemon is the CLI's `mete daemon` command and its messages are listed in Daemon protocol below (ADR-045) \[D\].
- The gateway accepts connections only from 127.0.0.1 and requires a per-session bearer token generated at daemon start \[D\].
- Modules with `trust: third-party` MUST run in a child process. Core and first-party modules MAY run in process \[C\].

## CLI

`mete` (package `@mete/cli`) is the composition root for one workspace, the current folder \[D\]:

- It loads the configuration, registers storage, security, quota, the four provider modules, the gateway, the file, shell and web tools, the browser, vcs-git, the registry, mcp-client (with the built-in `adapters/` folder) and core-engine, starts the lifecycle and opens the workspace at once; before it exits it stops the lifecycle. Phase 1 serves no gateway HTTP endpoint, because no child process needs one.
- `mete run "<goal>"` asks the router (tab 08) and starts a single-agent or a team run; `mete run --single "<goal>"` skips the router. When the router is unsure, the command prints its suggestions as `mete run --template <id>` lines and `--single`, and exits 2 [D]. `mete run --single "<goal>"` starts a single-agent run, and `mete run --resume <run id>` resumes a paused one. Both print one line per event: the model chosen, each tool call, a pause with its reason and the summary. A `quota` pause waits in the process until the reset and prints a hint that `models: both` in `.mete/gateway.yaml` lets paid models carry on, under `dailySpendUsd`, and under it one line for each provider that cannot carry the run on now and why: no key (`mete key set <id>`), its free quota used up until a time, or none of its models usable here (the privacy rules, the model mode, or a refused key) [D]; any other pause ends the command. Exit codes: 0 completed, 1 failed or cancelled, 2 left paused. Ctrl+C cancels the run. An `approval` pause of a single-agent run prints a hint: the policy asked about a tool call, and the built-in policy keeps `shell.exec@1` at level 1, so a run that needs commands needs `overrides: { "shell.exec@1": 2 }` in `.mete/policy.yaml` before it resumes. A run that fails with `unauthorized` prints a hint to check the keys with `mete key list`. Before a new run starts, when vcs-git is not active (the folder is not a git repository, or git is not installed), it prints one line that tasks work in place, without worktrees or checkpoints; a repository without a commit is noted in the log when a task starts (docs/08). A missing `.mete/policy.yaml` is not announced: the built-in policy applies, and the approval pause names it when it matters [D].
- `mete run --template <id> "<goal>"` starts a team run from `.mete/teams/<id>.yaml` or the repository's `templates/<id>.yaml`; it also prints the tasks, their status changes, approvals and artifacts. When a team task waits for the human, the run pauses with reason `approval` and the command prints how to answer: `mete approve <run id> [<task id>]` approves it, `mete revise <run id> <task id> "<feedback>"` sends it back; the task id is the template's id, and it may be left out of approve when one task waits. Both take the run lock like `mete run`, then drive the run on and print its events with the same exit codes [D].
- `mete run --continue ["<goal>"]` starts a run from the newest open handoff (tab 08, Run memory): it accepts the handoff exactly once, opens with its body in the start brief and takes its goal when none is given; without an open handoff it answers `not_found` with exit 1 [D].
- `mete events <run id>` prints the run's persisted events in order, one line each: the time, the event type, the module that published it, the task by its title and the agent by its role, and what happened (the line `mete run` shows, or the payload as JSON). A row that no longer parses is reported on standard error with exit 1, never skipped. `mete run --resume`, `mete approve` and `mete revise` read the task titles from the same history [D].
- `mete audit [<run id>] [--json]` prints the workspace audit log, newest first: the time, the run, the action and capability, the verdict and the policy rule; `--json` prints the rows as JSON (ADR-053) [D].
- `mete status [<run id>]` lists runs, newest first, with status, pause reason and goal.
- `mete mcp [<folder>]` serves the folder (the current one by default) to an MCP host over stdio (tab 10, METE as an MCP server). Like `mete run` it holds the run lock with recovery on for its whole life; stdout carries only the protocol and every message of its own goes to standard error. Without an active core-engine it says why and exits 1. It stops with exit 0 when the host closes stdin or on Ctrl+C [D].
- `mete daemon [<folder>]` serves the folder (the current one by default) to one desktop client over stdio (Daemon protocol). Like `mete mcp` it holds the run lock with recovery on for its whole life, stdout carries only the protocol, and without an active core-engine it still serves: it prints the reasons on standard error and answers every request with `not_ready`, except `mete/quota` and `mete/audit`, which need no engine (ADR-050, ADR-053). A held run lock or an invalid configuration ends it with exit 1 before it serves. It stops with exit 0 when the client closes stdin or on Ctrl+C, after the lifecycle has stopped [D].
- `mete stop <run id>` or `mete stop --all` cancels paused runs. A running run belongs to the `mete run` that holds it and stops with Ctrl+C there; `mete daemon` holds the lock the same way. Only the commands that take the run lock turn on core-engine's recovery, so `status` sees a run another process drives as `running`. One `mete run` (or `mete daemon`) drives a workspace at a time: it holds `.mete/cache/run.lock` with its process id from before recovery until its modules have stopped, a second `mete run` or `mete daemon` refuses with exit 1 while that process lives, and a lock left by a process that is gone is taken over. While the lock is held, `mete stop` refuses too and points at Ctrl+C in the holding terminal, because that process also waits for its quota-paused run.
- `mete registry search "<words>"` asks the `registry.search@1` adapters in order, the official registry and then the local one, and prints one line per entry, `<id> <version>  <runtime>  <source>`, with its description indented below; it installs nothing, prints `no entries for "<words>"` when none match and exits 1 when the search fails (tab 10, Registries) [D]. `mete registry add <name>` writes the newest version of that official registry server into `.mete/mcp.yaml` and prints what the user still has to fill in; exit 1 when it is refused (tab 10, Registries) [D].
- `mete key set <provider id>` reads a key from a hidden prompt, or from standard input when it is not a terminal, never from the command line, and stores it under the tab 09 keychain account; `mete key delete <provider id>` removes it; `mete key list` names the providers that have a key, never the key. Provider ids: `nvidia`, `openrouter`, `opencode-zen`, `groq`, `google`, `custom:<slug>`, and the search provider `tavily`, whose key goes under `search/tavily/apiKey` (tab 10).
- Arguments are parsed with `node:util` `parseArgs`. Logs are pino JSON lines in the global `logs/mete-<YYYY-MM-DD>.log`; the terminal shows only the event lines and errors.

## Daemon protocol

`mete daemon` and its one client speak `vscode-jsonrpc` over the daemon's stdin and stdout (`Content-Length` framing); every line the daemon writes for itself goes to standard error. Version 9 (ADR-055) has seven requests and one notification, and each side validates what it receives with the schemas in `@mete/contracts` (`daemon.ts`) \[D\]:

| Message | Kind | Params | Result |
| --- | --- | --- | --- |
| `mete/status` | request | `{ runId? }` | the `RunView` list that `mete status` prints; on failure a JSON-RPC error whose `data.code` is the `EngineError` code, or `not_ready` with `data.reasons` (the lines `mete status` prints) while core-engine is not active |
| `mete/run.start` | request | the `RunStart` of team.engine@2: `{ goal?, templateId?, priority?, continue? }` | `{ runId }`; errors as for `mete/status`, and `choose_template` carries the router's `data.suggestions` |
| `mete/run.approve` | request | `{ runId, input }`, `input` the `ApprovalInput` of team.engine@2 | `null`; errors as for `mete/status` |
| `mete/run.resume` | request | `{ runId }` | `null`; errors as for `mete/status` |
| `mete/quota` | request | none | `{ providers: [{ id, state, resetsAt? }], units: [{ providerId, unit, scope, used, limit, resetsAt?, history }] }`, `state` one of `ready`, `no_key`, `inactive`, `exhausted` (with `resetsAt`), `unusable`; `units` are the rows of `quota.reserve@4` `usage()` (ADR-054), `history` included since version 9 (ADR-055), read after the states; answered while core-engine is not active too |
| `mete/events` | request | `{ runId }` | `{ events, unreadable }`: the run's persisted events in order, as `mete events` reads them, and the count of rows that no longer parse; errors as for `mete/status` |
| `mete/audit` | request | `{ runId?, verdict?, action?, limit? }` | `{ entries }`: the workspace audit log (SECURITY.md), newest first, each row with `seq`, `ts`, `runId`, `agentId`, `action`, `capability`, `adapterId`, `argsSha256`, `verdict`, `rule` and `tainted`; answered while core-engine is not active too |
| `mete/event` | notification, daemon to client | one `MeteEvent` (docs/07) | none; every catalog event the bus publishes, in publish order |

A client that starts the daemon from Electron sets `ELECTRON_RUN_AS_NODE=1`. The desktop backend starts the daemon when the first message for a folder is sent, keeps one daemon for one folder at a time, stops it by closing its input, and restarts it after the desktop sets a provider key (ADR-049). The desktop starts the daemon detached from its own process group, so a quit or crash of the desktop leaves the daemon to stop on its closed input and free the run lock \[D\]. A new message or a changed shape needs an ADR and a new protocol version \[D\].

## Failure handling

- The kernel supervisor restarts a crashed child process. Default: at most 3 restarts in 5 minutes; then the circuit opens, the module is disabled, `module.disabled` is published and the user sees a calm notice \[D\].
- When a capability loses its provider, the registry resolves the next adapter in the fallback chain. Every capability defines what happens when its chain is empty (06 Kernel and modules); for example, plain grep serves `knowledge.search@1` \[C\].
- When the daemon crashes, the desktop restarts it. Runs resume from their persisted XState snapshots \[C\]. The desktop restarts it under the kernel supervisor's limits: at most 3 restarts in 5 minutes, then it stops starting it and shows the reason the daemon gave \[D\].
- Network loss pauses runs (`run.paused`, reason `network`) and resumes them when the connection returns \[C\].

## Data locations

| What | Where |
| --- | --- |
| Global data | Windows `%APPDATA%\METE\`; Linux `$XDG_DATA_HOME/mete` (default `~/.local/share/mete`); macOS later `~/Library/Application Support/METE` \[D\] |
| Global contents | `mete.db` (SQLite), `runtimes/`, `plugins/`, `registry/` (the local registry's `index.json`), `logs/`, `worktrees/`, `snapshots/`, `cache/` \[D\] |
| Personal vault | Chosen at onboarding; default `Documents/METE Vault` \[D\] |
| Workspace files | `.mete/workspace.yaml`, `bindings.yaml`, `policy.yaml`, `teams/`, `knowledge/`, `artifacts/`, `assets/`, mcp.yaml, skills/, `mete.db`, `cache/run.lock` (the CLI's run lock) \[D\] |
| Committed to git | Everything in `.mete/` except `mete.db*`, `cache/` and `worktrees/`; METE writes a `.mete/.gitignore` for these \[D\] |
| Secrets | Operating system keychain only (Electron `safeStorage`, `@napi-rs/keyring`) \[C\] |

## Main flows

1. Start a run: user or trigger → router (single agent or team template) → team engine creates the run and its tasks → `run.started`.
2. Model call: agent → `llm.chat@2` → quota scheduler reserves capacity → privacy filter and secret masking → gateway → provider adapter → response → quota recorded → `quota.consumed`.
3. Tool call: agent → capability resolved through the workspace binding → policy check → adapter (in process, MCP, CLI or HTTP) → result → `agent.tool.completed`.
4. Knowledge query: `knowledge.search@1` → workspace vault and code graph first, personal vault second → fused ranking.
5. Module removal: `deactivate()` disposes its resources → registry drops its providers → callers resolve the next adapter.

## Configuration

YAML files validated by Zod. Precedence, lowest to highest: built-in defaults → global settings → workspace `.mete/*.yaml` → run options \[D\]. Invalid or unreadable configuration is rejected with the file, path and reason; METE MUST NOT start a run on invalid configuration.

Global settings live in `settings.yaml` in the global data folder; its top-level sections use the workspace file names (`mcp:`, `policy:`). `ConfigReader.get(key)` takes a file name without extension (`bindings`, `mcp`): the workspace file is deep-merged over the global section of the same name (objects merge, arrays and scalars replace), and the module's Zod schema supplies the built-in defaults. The core merges run options when a run starts. At load the kernel checks YAML syntax and its own files (`workspace.yaml` `id`, `bindings.yaml`); a module's section is validated when it calls `get()`, and the error names the file the bad value came from. When `.mete/workspace.yaml` is missing, the loader creates it with a new UUID `id`, and it writes `.mete/.gitignore` when that is missing.

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
    providers/       provider adapter base + nvidia, openrouter, opencode-zen, groq, google, custom
    tools/           fs, edit, grep, glob, shell, web fetch, web search chain
    mcp/             MCP client and server, runtime manager, registry adapters
    knowledge/       code graph, vault, hybrid search
    core/            native team engine (XState), router, artifacts, autonomy, triggers
    engines/         optional adapters: crewai, metagpt, chatdev (Python via uv)
    ui-kit/          design tokens and shared React components
    ui-studio/       a run's view model (a fold over its events) and the studio view (PixiJS)
    ui-theia/        Theia extension: the daemon connection and the METE panels
    testing/         contract test kits, MSW fixtures, helpers
  templates/         research, seo-audit, web-dev, game-studio
  adapters/          declarative adapter mappings (YAML)
  docs/              these documents and ADRs
  AGENTS.md  ARCHITECTURE.md  CONTRIBUTING.md  THIRD_PARTY_NOTICES.md  LICENSE
```
