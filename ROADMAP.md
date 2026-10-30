# 16 Roadmap

Repository file: `ROADMAP.md`. Depends on: all specification tabs.

METE is built in 8 phases; each phase ends with a usable tool and an exit gate, and the public MVP (version 0.1.0) is the end of Phase 5 with the desktop UI, four lite templates and full MCP support \[C\].

Rules: a phase starts only when the previous exit gate passes \[D\]. AI agents work only on tasks of the current phase. From the end of Phase 1, METE is used to build METE \[C\].

| Phase | Delivers | Exit gate |
| --- | --- | --- |
| 0 Bootstrap | Repository, these documents in `docs/`, `AGENTS.md`, tooling (pnpm, Turborepo, Biome, dependency-cruiser, lefthook, Vitest), empty packages with module skeletons. Built with external free tools: OpenCode with free models, Cline or Kilo Code with OpenRouter free models \[C\] | `pnpm check` passes on the skeleton; hooks run |
| 1 Kernel and single agent | kernel, contracts, storage, security (policy, masking), quota (pool, scheduler, pause and resume), gateway, providers (NVIDIA, OpenRouter, OpenCode Zen, custom), tools-fs, tools-shell, vcs-git, single-agent mode, CLI `mete run` | A CLI agent finishes an edit task in a repository with free providers only; quota exhaustion pauses and resumes the run; performance baseline recorded |
| 2 Team engine and research | XState team engine, template schema and validation, artifacts, task and run state machines, approvals in the CLI, router, persisted events, run handoffs and the start brief (ADR-041), model mode with paid fallback and the daily spending unit (ADR-042), tools-web (fetch and HTTP search adapters), `research` template | The research team turns a topic into a cited report; revision limit and blocked flow tested |
| 3 Full MCP and SEO | Full MCP client, runtime manager (Node.js, uv, binaries), registry adapters, level 2 mappings, Exa MCP default search, browser module (Playwright, Lighthouse), MCP server mode, `seo-audit` template | An SEO audit report for a real URL; MCP Inspector conformance passes |
| 4 Web development | Verify gates, worktrees and merging, checkpoints, `web-dev` template (the knowledge items moved to Phase 6 and checkpoint rollback to Phase 5, ADR-044) | The web team builds a simple page that passes its build and a Lighthouse score of 85 |
| 5 Desktop and game studio (MVP 0.1.0) | Theia app, onboarding (with the CLI start checks: policy, key and git repository, and a pause message that names a missing key or the privacy rules), checkpoint rollback and file snapshots for folders that are not git repositories, run composer, team panel (studio, flow, board), approvals inbox, quota dashboard, settings, assets view, audit log, the Knowledge screen without its graph view (ADR-159), English and Turkish; `media.*`, `3d.*` and `gameengine.*` through MCP mappings; `game-studio` template; pulled from Phase 6 by the user (ADR-144): events turned into journal pages, both vaults with lessons, hybrid search with embeddings and rerank, knowledge in context assembly, memory aging and note restore, code graph, optional ai-memory MCP binding (ADR-041) | All four templates pass their acceptance scenarios in the desktop app; chaos test passes; Windows and Linux builds published |
| 6 Autonomy and intelligence | Autonomy level 3, triggers (schedule, file, issue, webhook), replay view, learning router, best-of-N attempts, retrospectives and vault consolidation, optional engine adapters (CrewAI, MetaGPT, ChatDev), optional tab completion module, knowledge graph view | A scheduled overnight run survives quota resets with pause and resume and leaves a report with pending approvals |
| 7 Reach (1.0.0) | macOS build, SignPath Foundation application, community registry, studio themes, frozen plugin API, opt-in shared memory server for vault notes and handoffs (ADR-041) | 1.0.0 released |

## Phase 1 task order

Agents SHOULD take Phase 1 work in this order, because each step depends on the previous one:

1. `contracts`: Result type, capability and event schemas.
2. `kernel`: registry, event bus, config loader, lifecycle, supervisor.
3. `storage`: SQLite connection, migrations, events table.
4. `security`: policy loader and checker, secret masking.
5. `quota`: units, pool, scheduler, pause and resume.
6. `providers`: base adapter, then NVIDIA, OpenRouter, OpenCode Zen, custom.
7. `gateway`: endpoints and request pipeline.
8. `tools`: fs, edit, grep, glob, shell; then `vcs-git`.
9. `core`: single-agent loop and run persistence.
10. `apps/cli`: `mete run`, `mete status`, `mete stop`.
