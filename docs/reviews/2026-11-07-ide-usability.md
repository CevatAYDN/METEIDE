# IDE usability implementation and evidence

Date: 2026-11-07
Baseline: `ac41090712762cb3eb7849e836b7449985947706` plus this working diff.
Scope: approved ADR-180 / Phase 5 usability continuation. Not full upstream parity.

## Implemented

- Compact neutral operational panels with native theme typography and controls.
- Persistent conversation composer, collapsible diagnostics and explicit optional
  Web/MCP capability groups. Selections persist across recovery and follow-up.
- Settings search over translated labels and section IDs, with explicit scope.
- Guided remote/local/JSON MCP drafts, strict unsupported-field and credential
  rejection, atomic duplicate checks and comment-preserving validated YAML writes.
- Read-only registry search/prepare and reviewable pinned drafts. Unresolved
  requirements remain visible; incomplete catalog additions are blocked.
- Safe save/connect: failed save never connects; active/unknown work never permits
  an unsafe restart. Engine quiescence blocks new work atomically, drains paused
  calls and includes restore/remove. Expected server identity is compared inside
  the daemon without returning raw secret values in settings.
- Native Theia Extensions integration. Explicit searches work; startup
  recommendations and layout restoration do not authorize remote discovery.
- Turkish/English keys and design documentation.

## Independent Review

Sol workers implemented bounded slices; Astra reviews inspected tool setup,
activation, extension privacy, conversation state and core concurrency.

Observed findings corrected before final acceptance:

1. Restored extension queries/details could accidentally authorize discovery.
2. Separate status/restart calls allowed work to start in between.
3. Normal Save revived a stale Connected result.
4. Raw drafts were compared with masked settings.
5. Binary import URLs bypassed credential checks.
6. Required catalog setup notes disappeared after adding a draft.
7. Retained YAML nodes could bypass final configuration validation.
8. Repeated quiesce calls returned before the shared drain finished.
9. Restore/remove were outside the admission gate.
10. MCP metadata could reach a model before taint was persisted.
11. Editing an unknown selection silently cleared another group.
12. Pending/duplicate replies could discard a newer selection or release a lock.

The final core/conversation re-review found no residual P1/P2 among its five
specific findings. This is a bounded source-review result, not blanket security
certification. Tool/setup corrections were covered by focused tests and the
live local-fixture flow; remote OAuth and arbitrary servers remain unverified.

## Checks

| Evidence | Result |
| --- | --- |
| `TURBO_CONCURRENCY=1 pnpm check` | Exit 0: Biome 1090 files, TypeScript passed, no dependency violations in 1305 modules / 4522 dependencies; Turbo 34/34 successful, 31 cached |
| Core / contracts tests | 374 / 219 passed |
| ui-theia / CLI tests | 641 / 167 passed |
| `pnpm --filter @mete/desktop bundle` | Exit 0; browser, Node and Electron bundles: zero errors |
| `screens.e2e.ts` | Passed: all 11 METE screen routes opened; no serious/critical axe violations or matched CSP failures in the scripted fixture |
| Conversation and layout | Passed: two turns preserve visible history; actual 700/1366 CSS viewport widths in light/dark/high contrast, scroll area bounded and composer actions present |
| Tools and Extensions | Local stdio save/connect, broken server, ordinary-save pending status, URL/local/JSON validation, native entry/shortcut/search passed in the preceding integrated runs |
| Final integrated acceptance rerun | Exit 0: 10/10 passed in 1.8 minutes, including unobstructed Send at actual 700/1366 widths |
| `git diff --check` | Exit 0 at the recorded source-review pass |
| Impeccable detector | 24 advisory radius findings, no blocking findings; controls normalized and remaining progress/dot radii documented; not a runtime a11y verdict |

The unmodified parallel test command first hit Windows EPERM on Vitest's shared
cache. Serial package execution changed scheduling only, not test coverage.
Final cache hits are from this correction pass, not solely the old baseline.
The bundle retains its prior `require.resolve("@mete/cli/package.json")` warning;
real daemon-backed Electron scenarios load successfully.

Test failures repaired during acceptance included protocol version/count
expectations, an invalid test UUID, strict union typing, a DOM-only import in
the command test, a circular UI type dependency, outdated instructional text
assertions and actual light-theme contrast regressions. No failing tests were
skipped or thresholds lowered.

The first viewport helper detached its CDP session too early. That evidence was
rejected: it now asserts actual `innerWidth`, and fresh 700px screenshots were
reviewed. A redundant start notification covering narrow composer controls was
removed; the final test also performs a trial click to prove Send is unobstructed.

```text
pnpm --filter @mete/desktop test:e2e conversation.e2e.ts usability-layout.e2e.ts settings-mcp.e2e.ts usability-tools.e2e.ts usability-extensions.e2e.ts
```

Raw logs: `.probe-ide-usability-{check,bundle,acceptance,electron-final,layout}.log`.
Screen captures: `.probe-ide-ui/`; final interaction captures are in
`apps/desktop/test-results/`. These are ignored local QA artifacts, not committed
product data. Fixtures isolate workspace/settings and use scripted models.

## Still Open

Historical status of the ADR-180 foundation. The subsequent approved F/P slices
and their current evidence are in `2026-11-07-ide-follow-through.md`; that report
closes VSIX lifecycle and approval-ordered merges, but not parallel writers or
task-local waits.

- Native VSIX install/enable/disable/uninstall was not exercised end to end.
- Public-marketplace availability, arbitrary MCP servers and desktop OAuth/
  required-secret completion are not certified; the simplified importer refuses
  unsupported auth instead of silently dropping it.
- Full writing-worker concurrency, approval-ordered merges and task-local waits
  remain the later ADR-174 slices.
- No Linux/WSL, installer/update/signing, real-provider or release-tier acceptance
  was performed. All upstream feature parity and Phase 5 exit-gate claims remain
  explicitly out of this report.
- The separate reference roadmap is proposed work, not automatically implemented.
  No commit or push is implied by this continuation.
