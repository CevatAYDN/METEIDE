# MCP Authentication And Credential Review

Date: 2026-11-07
Scope: ADR-184 / approved T1-T3 plan; pre-existing ADR180-183 edits preserved.
Status: Implemented; Windows source checks and bounded desktop flows verified.
Real-account/browser OAuth round trips, Linux and packaged release remain OPEN.

## Independent Review

Independent Astra source-review passes initially rejected the implementation.
The findings below were corrected and covered by the final regression batch.
Reviewer source inspection and executed tests are separate evidence.

| ID | Priority | Finding | Correction / state |
| --- | --- | --- | --- |
| R1 | P1 | Cancellation acknowledged while manifest publication was pending | Shared queue, rollback, durable cleanup marker and drain; unit fault injection plus SDK/real-loopback cancellation passed |
| R2 | P1 | SDK logged OAuth error descriptions, including HTTP 200 errors | Bounded protocol-preserving sanitization before SDK diagnostics; regression passed |
| R3 | P1 | Sampling/elicitation bypassed exact-value redaction | Recursive scrub and SDK schema revalidation before callbacks; regression passed |
| R4 | P1 | JSON decoding restored an escaped secret in mapped output | Redaction follows `resultScope` decoding; regression passed |
| R5 | P1 | Headless CLI could register before its terminal hook declined | Authorization hook omitted without terminal input; noninteractive and explicit-terminal regressions passed |
| R6 | P2 | Initial caller cancellation poisoned a cached session | Exact cached entry retires; replacement-session regression passed |
| R7 | P2 | Live refresh tokens were not persisted | Serialized durable live refresh after initial staging; rotation/failure regressions passed |
| R8 | P2 | Exact endpoint guard broke authenticated SSE | SDK-send-bound destination set; real-SDK scripted SSE handshake passed |
| R9 | P1 | Abort and shutdown raced SDK close, leaving Windows folders locked | Shared original close promise and shutdown drain; reproduced EBUSY failures and focused regressions passed after correction |
| U1 | P1 | Replacing one optional field erased other stored values | Serialized write-only merge; omission and concurrent replacement regressions passed |
| U2 | P1 | No-engine UI could not activate a new OAuth server | Typed readiness plus authoritative idle admission; unit and Electron no-provider setup passed |
| U3 | P2 | Edited credentials retained old Connected evidence | Dirty state suppresses Connected and blocks probes, including optional fields; regressions passed |
| U4 | P2 | UI discarded sanitized actionable diagnostics | Backend diagnostics retained; unit and Electron failed-server checks passed |
| U5 | P2 | Managed status omitted the E2E status element | One consistent status surface; desktop state assertions passed |

## Evidence

- Current HEAD: `ac41090712762cb3eb7849e836b7449985947706`; changes are uncommitted.
- `pnpm check`: exit 0, `34 successful, 34 total`; raw final output:
  `.probe-mcp-auth-check.log`. Biome, production/test TypeScript,
  dependency-cruiser, script checks and workspace tests passed.
- Selected unit totals: contracts 267, MCP 284, core 528, UI 811, CLI 195.
- Focused repair batches: MCP 63 tests, shutdown 28 tests, UI 11 tests;
  `.probe-mcp-auth-repair-tests.log`, `.probe-mcp-auth-close-tests.log`,
  `.probe-mcp-auth-ui-repair-tests.log`. These overlap the full batch.
- `pnpm --filter @mete/desktop bundle`: exit 0; `.probe-mcp-auth-bundle.log`.
  The existing `require.resolve("@mete/cli/package.json")` external warning
  remains; no build error.
- Electron: seven distinct flows verified. Initial batch had five passes and
  one ambiguous `summary` test selector; the corrected selector plus the new
  no-provider case passed in the focused two-case batch. Logs:
  `.probe-mcp-auth-electron.log`, `.probe-mcp-auth-electron-repair.log`.
- Actual Electron flows cover native keychain save, connect, app restart,
  local forget, no-provider OAuth configuration activation, loaded/broken
  probes, pending ordinary saves, guided URL/command/JSON setup and activation.
  Synthetic fixture credentials only; successful Forget removes their records.
- Six new viewport captures in `.probe-mcp-auth-electron/` were inspected:
  Light, Dark and High Contrast at 700 and 1366 pixels wide, 900 high. Required
  controls wrap without row overflow. The no-provider row capture is in the
  repair output directory. Legacy full-section element crops are clipped and
  are not used as visual acceptance evidence.
- The new credential scenario reports zero serious/critical axe violations.
  The final Impeccable detector returned `[]`; `git diff --check` was clean.
- Final independent review inspected source, assertions, logs and two viewport
  images: VERIFIED WITH CAVEATS, no additional actionable blocker in scope.

## Changed Surfaces

- `packages/contracts/src/domain/mcp-connection.ts`: versioned management and
  structured setup contracts; protocol33 retains legacy ports.
- `packages/mcp/src/application/mcp-connection.ts`: explicit connection
  lifecycle; infrastructure owns scoped keychain records and SDK adapters.
- `apps/cli/src/application/daemon-mcp-connection.ts` and `mcp-credentials.ts`:
  idle-gated management and write-only stdin.
- `packages/ui-theia/src/application/mcp-connection-view.tsx` and
  `src/infrastructure/mcp-settings.ts`: settings controls, states and activation.

## Acceptance Boundaries

OAuth success/cancel/refresh evidence uses the installed SDK, scripted HTTPS
responses and a real loopback callback. It is not a real-account login or a
native external-browser round-trip acceptance. The Electron evidence exercises
actual settings/daemon/keychain flows, not a packaged installer.

Linux/WSL, actual external-browser/account interoperability, signed/packaged
release, full screen-reader/zoom and additional viewport heights remain OPEN.
The rollback-marker-write-failure guard was source-reviewed; its dedicated
fault-injection branch is not separately covered. Existing manually authored
env configuration is not automatically migrated into the keychain.
No real model calls, account sign-ins, commit, push, enrollment or publication
were performed.
