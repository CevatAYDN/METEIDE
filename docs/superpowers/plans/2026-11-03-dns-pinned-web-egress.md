# METE verified open-work plan

This is an execution sequence, not one cross-package change. Work one package/concern at a time and run the project's required check after each slice. Prefer focused regression tests for security boundaries and user-visible behavior; skip redundant tests that only mirror implementation.

Do not alter pre-existing untracked work in `.mete/knowledge/`, `err.txt`, or `out.txt`.

## 1. DNS-pinned web egress — `@mete/tools`

Confirmed gap: `host-check.ts` checks resolution, but `web-fetch.ts` reconnects by hostname; Playwright route checks then continues normal browser networking; Lighthouse subresource requests do not pass through the route check.

Implement the approved shared egress design with Node built-ins only. A reusable address validator must reject empty, invalid, mixed public/private and private answers. `web.fetch` must pin each request/redirect connection while preserving Host, TLS SNI, certificate checks, abort and timeout behavior. A loopback-only per-browser-job proxy must pin HTTP destinations and HTTPS CONNECT TCP tunnels; keep TLS end-to-end. Chromium must not bypass the proxy for loopback. A folder preview exception may reach only the exact temporary server origin for that job. Always close proxy/browser resources on success, failure and cancellation.

Focused checks only: validated DNS result is the actual socket destination; private/mixed DNS never opens a connection; every redirect is checked; CONNECT and browser subresources use the proxy; TLS remains end-to-end; the exact preview origin works and other loopback hosts fail. Keep tests offline. Update `SECURITY.md` and `docs/10-tools-mcp-runtimes.md` only where their current claim needs correction.

Run `pnpm --filter @mete/tools exec tsc --noEmit --pretty false`, `pnpm --filter @mete/tools test`, then required `pnpm check`.

## 2. Parallel team tasks — `@mete/core`

Current-phase feature and acceptance criterion are in ADR-174 / `docs/08-orchestration-and-teams.md`; code still selects one working task. Implement the bounded in-flight scheduler in the core run state: at most the documented limit, ready tasks in template order, separate writer worktrees, shared model quota/run budget, pause/resume and human-wait semantics, ordered landing/merge, recovery and run completion only after all worktrees land. Add focused engine-level tests for two independent writers, dependencies, pause, human wait, merge order and restart recovery. Update the core task-flow documentation if observed behavior differs. Run `@mete/core` tests then `pnpm check`.

## 3. Personal/all vault search — `@mete/knowledge`

Search contract exposes workspace/personal/all, but implementation rejects personal scope and searches workspace only for all. Inspect onboarding/config ownership and existing vault adapters before changing; route queries through existing kernel capabilities, do not copy private notes into workspace, preserve note privacy and ignore rules, and label result scope correctly. Add focused end-to-end module tests that prove workspace-only, personal-only, all-scope results and private-note exclusion using temporary vaults. Update docs/11 and run `@mete/knowledge` tests then `pnpm check`.

## 4. Game Studio acceptance — current Phase 5 surface

The recorded Phase 5 gate says the prototype lacks working game-over behavior and cannot be behaviorally played by the current test path. First reproduce against the shipped template and trace its UI/state bug. Fix the smallest template defect; then use an existing browser/test capability to validate play, score, and game-over behavior in the desktop acceptance flow. Do not invent a new game-engine capability or implement deferred `gameengine.*` adapters without their spec. Update the template and Phase 5 evidence in docs/15 only with observed results. Run the focused desktop game-studio E2E and `pnpm check`.

## Explicitly not implementation blockers in this sequence

- `packages/engines/src/module.ts` is an intentionally empty Phase 6 optional-engine skeleton; do not implement CrewAI/MetaGPT/ChatDev in Phase 5. Keep its description aligned with “planned” status if documentation currently implies otherwise.
- `packages/ui-studio/src/module.ts` is also a skeleton, while the actual studio view is in `packages/ui-studio/src` and integrated via UI layers. Trace its package consumers before changing it; do not create an unused module implementation.
- Checkpoint restore is explicitly a user-initiated one-click action under ADR-079; protected config/team paths are excluded from checkpoint restore. Do not add a second policy prompt absent a spec change.
- Shell allow-list parsing was not shown to have a working bypass. Only investigate/fix it if a concrete failing security case is reproduced.

## Completion

For every slice, inspect changed paths and preserve the pre-existing untracked files. Do not claim completion for a slice until its focused check and `pnpm check` pass. Release-only packaging gates are separate from this code check and must be reported as not run unless executed.
