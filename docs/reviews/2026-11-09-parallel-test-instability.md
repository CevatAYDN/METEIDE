# Default-Parallel Test Instability (2026-11-09)

Status: open, pre-existing, not fixed in this batch.

## Evidence

- A clean worktree of `c5d02494` (no S2 work) ran `turbo run test --force
  --concurrency=10` four times: 1/4 passed. Failures: core `spawn-engine`,
  `conversation-mcp-policy`, tools `vcs-checkpoint-concurrency`. Logs:
  `logs/2026-11-09-baseline-c5d02494-run*.log`.
- At HEAD, with the S2 commits, repeated forced runs failed in a different
  package each time: core (`spawn-engine`, `verification-read`, `pair-review`,
  `scheduler-writing-recovery`), tools (`skill-source-lookup`,
  `skill-enumeration`, `shell`, `vcs-worktree`), mcp (`mcp-client` cancel
  count), cli (`daemon`, `lessons`, `skill-version-management`, `vault-tools`)
  and desktop (`build-cache`). Two of five sequential runs passed 34/34.
- Each failing test passes alone, including under 30 to 40 CPU-bound
  background jobs. A probe showed the `spawn-engine` run finishing in
  0.2 to 1.0 s under load against `vi.waitFor`'s 1 s default.
- Two consecutive `turbo run test` invocations overlapping in time also make
  Vitest refuse the shared `coverage` directory (`already in use by another
  Vitest process`); that is an operator error, not the instability above.

## Measurements (HEAD, forced, waits for every Vitest process to exit first)

| Setting | Runs passed 34/34 | Failures seen |
| --- | --- | --- |
| `--concurrency=10` (default) | 2/5 | mcp cancel count, tools vcs-worktree, desktop build-cache |
| `--concurrency=10`, `VITEST_MAX_WORKERS=4` | 0/5 | same set plus core team-engine, tools Git and skill-source |
| `--concurrency=3` | 2/4 | core pair-review, cli daemon |

Neither bounded setting removes the failures; worker limits alone made them
worse. Every failure is a deadline (`vi.waitFor` 1 s default, or the 5 s/15 s/
20 s test timeouts) on work that finishes well inside it when run alone.

## Decision

Raising individual deadlines moved the failure to another package every run,
so it was reverted: it would hide, not fix, the contention. No test, wait or
coverage threshold was weakened. The root cause is contention when every
package runs its full file-parallel Vitest pool at once on Windows (real Git,
PowerShell, SQLite and filesystem work); it needs one dedicated change, for
example bounded Vitest workers per package or a lower turbo concurrency for
`test`, measured against this baseline. Until then `pnpm check` must be rerun
on a timing failure and each failure checked alone, as recorded per slice in
`docs/superpowers/plans/2026-11-08-skill-activation-implementation.md`.

ADR-194 keeps the release gated on this being fixed.
