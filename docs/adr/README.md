# 04 Decisions (ADR log)

Repository files: `docs/adr/NNN-<slug>.md`, one per row. Depends on: 02 Glossary, 03 Architecture.

These 37 decisions are accepted. Changing one requires a new ADR that marks the old one "Superseded by ADR-NNN"; code MUST follow the accepted set.

| ADR | Decision | Reason | Rejected alternatives | Source |
| --- | --- | --- | --- | --- |
| 001 | TypeScript strict everywhere; Rust through napi-rs only for measured hot paths | One language for UI, core and plugins; agent SDKs and MCP SDK are strongest in TS; the compiler catches model mistakes | Python core, Go core | C |
| 002 | Desktop shell is Eclipse Theia on Electron | Monaco, terminal and VS Code extensions (Open VSX) come built in; contribution points avoid fork maintenance | Tauri (webview differences, sidecar needed), plain Electron + Monaco (no extension ecosystem), Code OSS fork (merge burden) | C |
| 003 | Workflows are deterministic state machines (XState v5); models only fill roles | Free models fail as managers: they forget tasks and loop | LLM-managed hierarchy, LangGraph | C |
| 004 | Every external thing goes through capability → contract → adapter → binding | Any tool can be swapped without touching core or templates | Direct tool calls, hardcoded integrations | C |
| 005 | Models come only from free cloud providers; no local models; internet required | Founder decision; no GPU requirement widens the audience | Local models through Ollama or LM Studio | C |
| 006 | Microkernel; third-party code in child processes; supervisor with circuit breaker | Removing or crashing a module must not break the system | Monolith, everything in process | C |
| 007 | Full MCP support, as client and as server | Images, 3D, game engines and most integrations arrive as MCP servers | Tool-calls-only MCP subset | C |
| 008 | Node.js and Python are managed runtimes downloaded on demand (Python through uv) | Many MCP servers need `npx` or `uvx`; users must not install anything | Requiring preinstalled runtimes; dropping Python | C |
| 009 | No Docker requirement. Safety = tool-level limits, git worktrees, command allow list, checkpoints. Containers are only an optional MCP runtime | Founder decision; most users have no Docker | Docker or Podman sandbox as a requirement | C |
| 010 | No GitHub Actions. Local CI with lefthook. GitHub is only the default adapter for registry, issues and releases | Founder decision; modularity covers GitHub too | GitHub Actions CI, cloud background agents | C |
| 011 | License Apache-2.0 | Free commercial use for everyone, patent grant, compatible with MIT and Apache sources | MIT, GPL | C |
| 012 | SQLite through better-sqlite3 (WAL) and Drizzle; FTS5 and sqlite-vec in the same files | One file, no server, fast, typed | PostgreSQL, a separate vector database | C |
| 013 | Hybrid search = FTS5 + vectors (NVIDIA embeddings) + graph + backlinks, fused with RRF, optional rerank | Founder asked for hybrid and vector together | Vector only, keyword only | C |
| 014 | Two vault layers, personal and workspace, both Obsidian-compatible Markdown | Token efficiency, privacy, portability | One global vault, a custom note format | C |
| 015 | Multi-unit quota pool; each provider adapter declares its units | Providers meter requests, tokens, credits and GPU time | Request count only | C |
| 016 | Web search default is Exa MCP without a key, then Tavily, Exa API, You.com and Firecrawl adapters. Brave is excluded. Pages are read by METE's own reader | Zero setup; no card; pages read without quota | SearXNG through WSL2 as default; Brave | C |
| 017 | ChatDev, CrewAI and MetaGPT ideas are ported natively; the original libraries are only optional `team.engine@1` adapters behind the gateway | Best parts with the least coupling | Python sidecars as main engine; ignoring them | C |
| 018 | Studio view uses PixiJS and tween.js, driven only by events; Kenney CC0 starter assets | Light 2D renderer; every visual must be real | Phaser, DOM animation | C |
| 019 | Windows first; Linux through WSL2; macOS after MVP | Founder's machine is Windows | Equal three-platform start | C |
| 020 | Documentation in English; UI in English and Turkish | Free models read English most reliably; the founder is Turkish | Turkish-only documentation | D |
| 021 | Providers that train on or publish prompts are off by default; secrets masked; `.meteignore` paths never sent | Privacy by default | More models by default | C |
| 022 | All model calls go through a local OpenAI-compatible gateway (Hono) on 127.0.0.1 with a session token | One choke point for quota, masking and logs, also for MCP sampling and Python engines | Direct provider calls from each module | C |
| 023 | Templates name model tiers; models are discovered from each provider's `/v1/models` at runtime | Free catalogs change every few weeks | Model names in templates | C |
| 024 | The core runs as a separate daemon process | Agent crashes never take the editor down | Core inside the Theia backend | D |
| 025 | No telemetry; logs stay local | Privacy; no servers | Opt-in telemetry | D |
| 026 | The team engine capability is `team.engine@1`; game engine capabilities are `gameengine.*@1` | "engine" meant two things in the conversation | One shared `engine` namespace | D |
| 027 | Workspace folder `.mete/`, ignore file `.meteignore` | Matches the product name | `.crew/` from early examples | D |
| 028 | Autonomy levels 0 to 3, default 2 | Safe daily default; full autonomy only by choice | On/off autonomy | C |
| 029 | Tab completion is an optional module | Per-keystroke calls do not fit free limits | Tab completion in core | C |
| 030 | Image and 3D generation run through MCP adapters bound to `media.*` capabilities | Founder decision; any MCP server can serve them | Native media provider code | C |
| 031 | Agent Skills (`SKILL.md` folders) are supported | Thousands of ready skills | A custom skill format | C |
| 032 | Builds ship unsigned first; Windows signing through SignPath Foundation when accepted; electron-updater; GitHub Releases as default distribution adapter | No paid service | Paid certificates | C |
| 033 | Conventional Commits; Changesets for SemVer versions | Machine-readable history; changelogs for free | Free-form commits | D |
| 034 | Expected failures return `Result<T, E>`; exceptions only for programmer errors | Explicit error paths that models cannot ignore | Exceptions everywhere | D |
| 035 | A new runtime dependency requires a new ADR | Keeps the stack small and reviewed | Free dependency addition | D |
| 036 | Shared kernel types (`Result`, `CapabilityRef`, `ModuleManifest`, event envelope) live in `@mete/contracts`; `kernel` imports `contracts` and nothing else; `contracts` imports no METE package | ROADMAP builds `contracts` before `kernel` because the kernel depends on it; tab 07 puts event schemas, including the kernel's `module.*` events, in `@mete/contracts` | Types inside `kernel` (contracts would then import kernel); a third shared package | D |
| 037 | The kernel's event bus and circuit breaker are small own code in `@mete/kernel`, not Emittery or opossum | Tab 06 fixes synchronous `publish(): void` delivery and a breaker that opens after 5 consecutive failures; Emittery's `emit` is async, and opossum trips on an error rate over a rolling window with no consecutive-failure mode | Emittery with an async `publish`; opossum with tab 06 loosened to an error rate | D |

## ADR file template

```markdown
# ADR-NNN: <decision in one line>
Status: Accepted | Superseded by ADR-NNN
Date: YYYY-MM-DD
## Context
<the problem and forces, 3-6 sentences>
## Decision
<what we do, with MUST/SHOULD language>
## Consequences
<what becomes easier, what becomes harder>
## Alternatives rejected
<each with one-line reason>
```
