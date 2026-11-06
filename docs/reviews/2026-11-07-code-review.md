# Code review and Phase 5 continuation

Date: 2026-11-07
Baseline: `07e3534b84d33b27c729bf85f4742f1c37f69f6d` plus the user's existing working tree.
Status: review/fix pass and bounded non-writing scheduler implemented; Windows checks and selected Electron acceptance passed. Full ADR-174 and release acceptance remain open.

## Scope and method

The review covers the current checkout, not just the latest commit. The lead traced core
execution and persistence; three independent Astra reviewers covered platform,
integrations and interfaces. Sol workers implement bounded core, UI and integration
changes. Tests are authored with each change but executed together at the end, following
the user's explicit instruction on 2026-11-07.

Review groups:

- Platform: contracts, kernel, storage, security, quota, gateway and providers.
- Integrations: tools, MCP, knowledge, engines, testing, mappings and the four templates.
- Interfaces: CLI, desktop, ui-theia, ui-studio, ui-kit and maintenance/build scripts.
- Core: run/task state, cancellation/recovery, checkpoints, follow-up, review, attempts,
  tool dispatch, persistence and the pending ADR-174 scheduler.

This is a risk-based whole-repository review, not a claim that every branch was executed.
Remaining provider-specific branches, all external MCP servers, native Linux behavior,
installed-app updates and live-model acceptance are not certified by this review.

## Findings and remediation

Locations below identify the implementation files rather than obsolete baseline line numbers.
Every item was established by tracing source before its regression was written.

| ID | Priority | Finding | Package/file | Status |
| --- | --- | --- | --- | --- |
| C1 | P1 | A crash after a user pause could replay an uncertain writing call; paused rows were not settled on recovery. A known policy refusal must not keep an uncertain-write marker. | core: application/recovery.ts, run-driver.ts | Fixed; automated regression passed |
| C2 | P2 | File-snapshot rollback restored/deleted workspace knowledge, contrary to ADR-146. | core: domain/snapshot-plan.ts | Fixed; Windows/Linux casing-branch regressions passed on Windows |
| P1 | P1 | Provider error and discovery messages reached global logs before masking. | gateway: application/chat.ts, prepare.ts | Fixed; fake-provider regression passed |
| P2 | P2 | Breaking iteration at the terminal finish skipped clearing model failure history. | gateway: application/chat.ts | Fixed; terminal-consumer regression passed |
| P3 | P2 | A failed quota save discarded dirty usage and learned limits. | quota: application/quota-reserve.ts, domain/pool.ts | Fixed; failed-save/reload and shutdown regressions passed |
| I1 | P1 | Built-folder previews served ignored child files to page scripts. | tools: infrastructure/static-server.ts and preview callers | Fixed; workspace/worktree/junction regressions passed |
| I2 | P1 | Malformed private-note frontmatter became searchable and eligible for embedding. | knowledge: application/search.ts | Fixed; BOM, existing-index upgrade and embedding regressions passed |
| I3 | P2 | Mixed-case Windows history paths bypassed the vault read prohibition. | knowledge: domain/note.ts | Fixed; Windows regressions passed |
| I4 | P2 | MCP progress/error/stderr text reached global logs unmasked. | mcp: application/sessions.ts, mcp-tools.ts | Fixed; masked message and shutdown-drain regressions passed |
| I5 | P2 | A mapped MCP call converted session approval/denial into io, losing policy semantics. | mcp: application/mapped.ts | Fixed; refusal regressions passed |
| I6 | P2 | Fetch response-body failures escaped the expected Result failure path. | tools: application/web-fetch.ts | Fixed; broken/aborted body regressions passed |
| U1 | P1 | Pre-push scanning omitted secrets introduced by merge resolutions. | scripts/secret-scan.mjs | Fixed; real isolated Git history regression passed |
| U2 | P2 | Release security scanning inspected an old desktop bundle before rebuilding. | scripts/release-check.mjs | Fixed; VM ordering/fail-closed regressions passed |
| U3 | P2 | A packaging subprocess failure exited before restoring pnpm state and removing staging. | desktop: scripts/package-win.mjs | Fixed; VM cleanup regression passed, real installer not rebuilt |
| U4 | P2 | Delayed quota responses overwrote newer Home runs/approvals. | ui-theia: infrastructure/home-store.ts | Fixed; stale/current-failure and window-preservation regressions passed |
| U5 | P2 | A delayed follow-up could replace a newly opened composer. | ui-theia: infrastructure/board-widget.tsx | Fixed; widget navigation/disposal regressions passed |
| U6 | P2 | After a successful start, the composer reset to router mode instead of single-agent mode. | ui-theia: infrastructure/run-composer.tsx | Fixed; start/reopen regression passed |

Independent review caught and required corrections for current quota transport failure,
unchanged pre-fix private-note caches, leading BOM metadata, and ADR-067's requirement to
retain masked progress messages. Assertions were not weakened to accept these defects.

## Phase 5 development

ADR-174 remains bounded to non-writing task scheduling in this continuation:

1. Persist request reservations and reject stale worker results.
2. Connect task-local sessions to actual bounded concurrent model dispatch.
3. Preserve pause/cancel/recovery and legacy snapshot behavior.

Writing worktree concurrency and task-local approvals are separate later slices.
No new public capability, provider integration, runtime dependency or event schema is
authorized by this continuation. OmniRoute and FreeLLMAPI remain deferred. SignPath
enrollment, account changes and publication remain owner actions.

## Verification

Before edits, `pnpm check` exited 0: Biome checked 1016 files, dependency-cruiser found
no violations in 1228 modules / 4176 dependencies, and Turbo reported 34 successful
tasks, all 34 cached. This is baseline evidence, not verification of the edits above.

Final commands and outcomes:

| Command | Result |
| --- | --- |
| `pnpm check` | Exit 0; Biome 1041 files, TypeScript passed, no dependency violations; 34/34 Turbo tasks successful, 29 cached on final rerun |
| Included `pnpm test:scripts` | 4 passed, 0 failed/skipped; isolated Git and VM-substituted process/filesystem effects |
| Core tests | 362 passed, including real gated overlap, slot/dependency order, reservations, summary budget, pause/cancel, HEAD-era migration and team-writer recovery |
| Gateway / quota / knowledge / MCP / tools tests | 119 / 65 / 86 / 105 / 163 passed respectively |
| ui-theia / CLI tests | 573 / 162 passed respectively |
| `pnpm --filter @mete/desktop bundle` | Exit 0; browser, Node and Electron bundles finished with zero errors |
| Selected Electron acceptance | 11 passed in 2.5 minutes; command below |
| `git diff --check` | Exit 0 |

```text
pnpm --filter @mete/desktop exec playwright test e2e/conversation.e2e.ts e2e/run-flow.e2e.ts e2e/templates.e2e.ts e2e/seo-audit.e2e.ts e2e/web-dev.e2e.ts e2e/game-studio.e2e.ts
```

Raw final logs are in `%TEMP%/mete-review-2026-11-07-{check,bundle,electron}.log`.
The final Turbo rerun reused passing package results from this same correction pass;
the modified runtime packages were not accepted solely on the pre-edit baseline cache.
All automated model flows used scripted adapters, with no real-provider test calls.
The bundle retains a warning about `require.resolve("@mete/cli/package.json")`; the
selected Electron flows loaded the real daemon successfully.

The first validation found test typing/import issues, circular type dependencies,
and complexity/file-size violations. These were corrected without rule suppressions.
One Home assertion compared URI implementation-cache fields; it now checks the actual
URI string, call count and unchanged `preserveWindow: false` requirement. No failure
was skipped. The migration and privacy fixes received independent source review.

## Remaining acceptance

- Full ADR-174: writing-worker concurrency, approval-ordered merge queues, task-local
  policy waits and accepting human approvals while the run continues remain separate.
- Linux/WSL execution was not run: `wsl --list --quiet` listed only `docker-desktop`;
  no development distribution was available, and Docker was not used as a requirement.
- The installer was not rebuilt/installed; real update, signing, publication and the
  complete release-tier checks were not run. The maintenance VM tests prove control
  flow, not a real installer or release security scan.
- The actual two-turn conversation screenshot was inspected. The large summary and
  separate sidebar run rows remain visual-polish work; no redesign is claimed.
- Scripted Game Studio gameplay acceptance is not acceptance of a newly generated
  real-model game. No Phase 5 exit-gate or release-readiness claim is made.
