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
| 5 Desktop and game studio (MVP 0.1.0) | Theia app, onboarding (with the CLI start checks: policy, key and git repository, and a pause message that names a missing key or the privacy rules), checkpoint rollback and file snapshots for folders that are not git repositories, run composer, team panel (studio, flow, board), approvals inbox, quota dashboard, settings, assets view, audit log, the Knowledge screen without its graph view (ADR-159), English and Turkish; `media.*`, `3d.*` and `gameengine.*` through MCP mappings; `game-studio` template; pulled from Phase 6 by the user (ADR-144): events turned into journal pages, both vaults with lessons, hybrid search with embeddings and rerank, knowledge in context assembly, memory aging and note restore, code graph, optional ai-memory MCP binding (ADR-041); best-of-N attempts (ADR-162); parallel tasks (ADR-174) | All four templates pass their acceptance scenarios in the desktop app; chaos test passes; Windows and Linux builds published |
| 6 Autonomy and intelligence | Autonomy level 3, triggers (schedule, file, issue, webhook), replay view, learning router, retrospectives and vault consolidation, optional engine adapters (CrewAI, MetaGPT, ChatDev), optional tab completion module, knowledge graph view | A scheduled overnight run survives quota resets with pause and resume and leaves a report with pending approvals |
| 7 Reach (1.0.0) | macOS build, SignPath Foundation application, community registry, studio themes, frozen plugin API, opt-in shared memory server for vault notes and handoffs (ADR-041) | 1.0.0 released |

Current Phase 5 additions approved by the user: conversation-first single-agent
follow-ups (ADR-178; `docs/superpowers/specs/2026-11-06-conversation-first-design.md`)
and SignPath readiness with an optional, manually approved signed-release pipeline
(ADR-179; `docs/superpowers/plans/2026-11-06-signpath-readiness.md`). Neither changes
the Phase 5 exit gate or makes cloud CI a local-development requirement.

ADR-180 adds the approved IDE-usability continuation: compact operational UI,
guided MCP setup, explicit conversation tools and user-initiated editor extension
management. See `docs/superpowers/specs/2026-11-07-ide-usability-design.md`.

ADR-181 completes the approved Phase 5 parallel-task scope with verified native
file isolation and exact task-local decisions; it does not pull in Phase 6.
Implementation and current acceptance evidence are tracked in
`docs/reviews/2026-11-07-parallel-control.md`.

ADR-182 implements the user-approved C1-C3 continuation: persistent conversation
identity, idempotent messages and a single searchable sidebar entry while retaining
immutable per-turn runs. ADR-183 approves C4-C5 explicit editor-context snapshots;
their implementation ledger is `docs/superpowers/plans/2026-11-07-editor-context.md`.
ADR-184 approves T1-T3 guided MCP sign-in and target-bound keychain credentials;
implementation is tracked in `docs/superpowers/plans/2026-11-07-mcp-auth-and-secrets.md`.
Windows source/desktop evidence and explicit remaining acceptance boundaries are
recorded in `docs/reviews/2026-11-07-mcp-auth-and-secrets.md`.
The G/K decisions remain separate.

ADR-189 adds the approved Phase 5 S1 skill-management foundation: local discovery,
version review, explicit approval/disable and Settings visibility. It does not
enable agent skill activation. ADR-190 separately approves S2 context integration.
Implementation and evidence: `docs/reviews/2026-11-08-skill-foundation.md`.

S2 development follows the approved package-sized sequence in
`docs/superpowers/plans/2026-11-08-skill-activation-implementation.md`.
Its runtime, UI and end-only validation are in progress, not a Phase 5 exit pass.
ADR-191 adds the user-approved receipt-free selection preflight to this S2
delivery; it does not widen permissions or change the Phase 5 exit gate.

ADR-192 adds the approved team-usability recovery: direct team/Skills/Permissions
routes, structured existing policy rules, user-initiated skill editing and clearer
task-scoped learning controls. A manually started, human-reviewed improvement
proposal moves into Phase 5, with its concrete backend contract gated by the I0
design. Automatic retrospectives, training and the other Phase 6 work stay out.
Delivery: `docs/superpowers/plans/2026-11-09-team-usability-recovery.md`.
The bounded UI recovery has Windows source evidence in
`docs/reviews/2026-11-09-team-workflow-recovery.md`: final root34/34, scripted
Electron53/53 and chaos1/1. This does not complete S2 activation, the proposed
manual-improvement backend, installed-application acceptance or the Phase 5 gate.

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
