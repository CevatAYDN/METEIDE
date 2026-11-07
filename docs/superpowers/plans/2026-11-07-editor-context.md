# Explicit editor context: C4-C5 implementation

Date: 2026-11-07
Status: Windows source-built acceptance complete; Linux and release gates open.
Decision: ADR-183. Baseline: ac410907 plus existing uncommitted ADR180-182 work.
No commit, push, provider calls, signing or unrelated refactors.

## Bounded slices

Each row owns one package/concern and targets about 300 changed lines including
tests. Split further if needed; no worker owns another row's package.

| ID | Owner | Package/files | Depends | Done/check | Status |
| --- | --- | --- | --- | --- | --- |
| A1 | Lead | contracts context schemas/defaults/test | ADR183 | Strict size/path/range boundaries | verified (Windows) |
| A2 | Lead | contracts v2 ports/daemon/barrel/test | A1 | @1 unchanged, v2 typed | verified (Windows) |
| A3 | Sol files | tools context path inspection/test | A1 | canonical workspace/ignore/protected/links | verified (Windows) |
| A4 | Sol files | tools bounded text inspection/module/test | A3 | binary/encoding/cancel, no model exposure | verified (Windows) |
| A5 | Sol core | core prepare/mask/digest/test | A2,A4 | fail-closed fixed preview | verified (Windows) |
| A6 | Sol core | core context admission/receipt/test | A5 | atomic/no duplicate/no stale append | verified (Windows) |
| A7 | Sol core | core persisted context/read/recovery/test | A6 | restart/delete/taint, empty legacy context | verified (Windows) |
| A8a | Lead | cli context routes/test | A2,A7 | strict input/output and sanitized errors | verified (Windows) |
| A8b | Lead | cli context composition test | A4,A7 | fake gateway, restart and ignored replay | verified (Windows) |
| A9 | Sol UI | ui-theia transport/test | A2,A8a | new requests, no fallback | verified (Windows) |
| A10 | Sol UI | ui-theia editor capture/commands/test | A9 | exact buffer/range, explicit intent | verified (Windows Electron) |
| A11 | Sol UI | ui-theia context draft/preview/test | A10 | update/remove/failure/navigation retention | verified (Windows Electron) |
| A12 | Sol UI | ui-theia send/history/test | A11,A7 | immutable retry + sent context view | verified (Windows Electron) |
| A13 | Lead | desktop context e2e | A12 | real editor selection/start/reply/restart | verified (Windows Electron) |
| A14 | Astra review | read-only semantic review | A3-A13 | privacy, concurrency, boundary regressions | verified (source + captured UI) |

Lead owns shared docs, changeset and lockfile. Workers write tests before
implementation, but do not run builds/tests while implementing. Lead runs one
serialized `pnpm check` after integration, then focused offline Electron tests.
Only failed paths rerun after corrections. Windows source evidence does not
close Linux/packaging/provider gates.

## State and evidence

No automatic lead-hook recovery is claimed. This ledger records this chat's
approved scope and will be updated as slices complete.

- Sol files/core streams disconnected once and were resumed with their existing
  files and assignments; neither error was treated as successful implementation.
- `pnpm install --offline --ignore-scripts`: exit 0, downloaded 0, existing
  @theia/editor 1.76.0 linked directly for ui-theia. No model/network probe.
- Tests were authored before implementation and run after the coherent batch.
- First `pnpm check` stopped at Biome before TypeScript/tests. Mechanical import
  fixes and bounded function/line refactors were applied without changing checks.
- Backend review: validator revocation between awaits, error-data masking,
  chained-link traversal and native-adapter layering need corrections.
  Core revocation, CLI strict error-envelope and tools link traversal/layering
  fixes are implemented. Independent Astra re-review resolved all four at source
  level; their runtime regressions passed in the final check.
- UI review: preserve retry identity after failed/no-op preparation, retain the
  complete initial uncertain send across workspace navigation, clear late-success
  drafts consistently, synchronize history recovery scope, and enforce historical
  read-only authority in native commands. All five corrections independently
  re-reviewed and resolved at source level; their regressions passed.
- Electron acceptance now also covers four expanded large previews and checks
  the Send/Start action stays inside the narrow/wide viewport.
- `pnpm exec tsc -b`: exit 0 after naming the exported draft-store type.
- `pnpm --filter @mete/desktop bundle`: exit 0; existing require.resolve external
  warning remains. No release packaging or provider requests.
- Final `pnpm check`: exit 0, 34/34 tasks, 31 cached, 18.497s; no Biome warnings.
  Contracts 262, core 528, CLI 190, UI 765 tests passed; tools 239 passed and
  two platform-specific cases skipped. Log `.probe-context-check.log`.
- Final Electron: two passed in 1.5m, `.probe-context-electron-final.log`.
  Twelve captures inspected; ArrowDown scrolling, primary action visibility and
  the final HC700 axe checks passed. Earlier C3 regression passed separately.
- Final independent visual/source-delta verdict: ship / verified with caveats.
  Mechanical detector returned `[]`; existing DESIGN.md remains unchanged.
  Full evidence and limits: `docs/reviews/2026-11-07-editor-context.md`.

## Direction contract

THESIS: An explicit source copy joins the existing composer without moving the
primary message action or hiding what will be sent.
OWN-WORLD: Existing native Theia theme, compact codicons, flat rows and local
errors; no new visual identity or decorative imagery.
STORY: Choose source, inspect masked text, update/remove, send, inspect the
immutable sent version.
FIRST VIEWPORT: Attachment menu and compact source rows sit with composer
controls. Expanded code scrolls within bounded space; Send remains reachable.
FORM: Ordinary extension of the approved conversation surface, no concept roll.
FINISH: unreviewed and undocumented is unfinished; this build ends with the
finish review, the verdict, DESIGN.md, and every shipping raster carrying its
provenance. Existing DESIGN.md remains authoritative; no raster assets added.
