# Editor context acceptance

Date: 2026-11-07
Scope: ADR-183 / C4-C5, Windows source-built desktop.
Baseline: ac410907 plus the preserved, uncommitted ADR180-182 work.
Implementation: Sol coding workers; integration/checks: Astra lead;
independent source and visual review: Astra reviewers.

## Delivered

- Explicit Add selection / Add open file from the native editor and composers.
  Current unsaved buffer text is captured without saving it.
- Masked fixed-copy preview with source/range, unsaved marker, Update and Remove.
  Existing workspace text sources only; four copies, 32 KiB each / 64 KiB total.
- `fs.context@1` validates current workspace boundaries, lexical/canonical and
  intermediate link paths, ignore/protected paths, file kind and bounded UTF-8
  prefix. Missing validation/masking fails closed.
- `conversation.thread@2` and protocol32 prepare/start/reply/read routes;
  @1 and legacy inputs are unchanged. Snapshots participate in the atomic
  run/membership/receipt transaction and exact retry identity.
- Tainted, immutable per-turn context survives restart, is excluded from authored
  search/title text, and is removed with its run. UI drafts survive in-session
  navigation and failure, not application exit.
- Internal context envelopes are collapsed readable attachment details, not
  ordinary user-message JSON. Historical views do not claim to be busy and
  cannot mutate attachments through native commands or stale callbacks.

## Automated Evidence

Final command: `TURBO_CONCURRENCY=1 pnpm check` (PowerShell environment setting).
Log: `.probe-context-check.log`, exit 0.

```text
Checked 1264 files in 2s. No fixes applied.
no dependency violations found (1482 modules, 5356 dependencies cruised)
Tasks: 34 successful, 34 total
Cached: 31 cached, 34 total
Time: 18.497s
```

Production and test TypeScript checks and script checks passed. Package results:
contracts 262; core 528; CLI 190; UI 765 tests passed.
Tools: 239 passed, two platform-specific cases skipped on Windows.
No new lint diagnostics remain. `git diff --check` passed.

`pnpm --filter @mete/desktop bundle`: exit 0, `.probe-context-bundle.log`.
The existing bundler warning about externalizing `@mete/cli/package.json`
remains; it is not a failed build or a packaging/signing check.

## Desktop Evidence

Final command: `pnpm --filter @mete/desktop exec playwright test
editor-context.e2e.ts --output=../../.probe-context-electron-final`.
Log: `.probe-context-electron-final.log`, exit 0, two passed in 1.5 minutes.

1. Actual unsaved editor selection, fixed preview, explicit update/removal,
   failed send after an ignore-rule change retaining text and attachment,
   successful retry, a second attached turn in one conversation, real process
   restart and per-turn sent-copy inspection. The source on disk stays unchanged.
2. Four expanded 60-line previews, fifth-copy refusal without losing the four,
   actual focus/ArrowDown scrolling, primary action within the viewport and
   no horizontal overflow in Light/Dark/High Contrast at 700 and 1366 pixels.

Both scenarios finish with no serious/critical axe findings on their final
High Contrast 700-pixel state. This is not a full WCAG certification.
The prior C3 conversation search/history/restart regression also passed in
`.probe-context-electron.log` before the final presentation-only corrections.

All 12 final images were opened and checked for the expected state and valid
rendering. Under `.probe-context-electron-final/`:

- `editor-context.e2e.ts-capt-69cc6-s-and-restores-sent-context/`
  contains `context-sent-<theme>-<width>.png`.
- `editor-context.e2e.ts-keep-6af33-d-the-send-action-reachable/`
  contains `context-drafts-<theme>-<width>.png`.

The mechanical design detector returned `[]` for the six primary changed
view/CSS files (`.probe-context-design.json`). This is a scoped mechanical
result, not proof of every design/accessibility property.

## Review Corrections

Independent source review identified and then rechecked:

- Adapter revocation between asynchronous validation and admission.
- Unvalidated error-envelope metadata bypassing masking.
- Chained links escaping and returning to the workspace.
- New native adapters importing concrete infrastructure from application files.
- Retry identity lost on rejected/stale/no-op attachment preparation.
- Initial uncertain payload/model/tools lost across workspace navigation.
- Late success leaving a stale sendable goal without its attachments.
- History-read recovery retaining the wrong editable scope.
- Native commands bypassing historical read-only state.

All nine were resolved at source-review level and have executed regression
coverage in the final check. The independent final visual/source-delta verdict
is **ship / verified with caveats** for this Windows source-built slice.
The reviewer inspected all 12 captures and the raw check/Electron/detector logs;
it did not rerun tests. No blocking finding or recapture request remained.

The first Electron attempt did not activate/edit the Monaco buffer correctly.
The fixture now uses the established view-lines click/typing path and asserts
the edited text before capture; content and unchanged-disk assertions remain.
The next run exposed a real keyboard-accessibility defect in scrolling previews,
which was fixed rather than excluding the axe rule. Raw envelope presentation
and false historical busy text were also fixed and recaptured.

Earlier unit failures were handled without weakening behavior assertions:
protocol-version expectations now name approved version32; the legacy reply
fixture stops the engine after its state assertions, because shutdown now closes
admission; the command-only suite mocks the added editor contribution while
dedicated integration/Electron tests exercise it. Existing command order is kept.

## Limits

No real provider was called: unit tests use fakes and Electron uses the scripted
adapter. Linux/WSL, packaged release, signing/update, live provider behavior and
formal accessibility certification remain unverified. Full Tab traversal,
screen-reader use, zoom and shorter viewport heights were not accepted by this
capture set. Checks are not an OS
sandbox against concurrent external filesystem replacement.

Untitled/remote/image/team attachments and persisted unsent drafts are out of
scope. No commit, push, account change or publication was performed. T/G/K and
Phase 6 work are not included in this acceptance.
