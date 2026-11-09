# Conversation Discovery: U3-U5

Date: 2026-11-08, Europe/Istanbul.
Baseline: `c5d02494f65abd3709ecd8c559b8fb5dfde43d4b` plus the current working tree.
Verdict: verified for this bounded Windows source-built UI batch, not a release.
Decision: ADR-186. No commits, publication, installation or new dependencies.

## Changes

- U3: the displayed run's unique taskless assistant supplies Last model from
  the event fold, outside diagnostics. Missing/ambiguous evidence is explicit.
  Preference uses the existing picker's acknowledged state, with known flat
  run metadata as the standalone fallback. Pending, refused and stale changes
  are not displayed as successful; clearing does not resurrect old metadata.
- U4: local Settings search finds translated hints and linked action labels,
  preserving category-label and narrower section-name/title precedence.
  Turkish dotless-i folding covers uppercase hint queries. Values, paths,
  secrets, internal command IDs and unlinked actions are not searched.
- U5: a successful empty conversation list distinguishes blank/whitespace
  queries from searches with no matches; errors, loading and missing folders
  never assert empty success. Existing actions remain.
- English/Turkish resources, Changeset, docs/13 and ADR-186 were updated.
  No core behavior, daemon contract, event or package public API was changed.

## Source Review And Corrections

Sol workers owned disjoint U3/U4/U5 files. Astra/Epicurus reviewed the actual
source and assertions without running tests or launching the IDE.

Main's further source trace corrected the initial assumption of a wrapped
single-agent preference: `core/application/pinned.ts:validateStartPrefer`
requires a flat ModelRef. No invented `prefer.single` support remains.

Independent review found a P2 stale-preference path: the picker updates its
session after acknowledgment, but no run event refreshes `RunFacts`.
U3.1 now consumes that same session state instead of adding another RPC.
Re-review closed the finding by source inspection. The suggested regression
for clearing an initially saved preference was added before final validation.

All tests were authored during development but first executed at the final
validation stage, per the user's instruction. Unexecuted tests were never
reported as observed RED or GREEN.

## Final Validation

- First check stopped at import ordering in `settings-groups.test.ts`; the
  import-only correction retained all assertions.
- `pnpm check` then exited 0: Biome 1336 files; dependency-cruiser 1548 modules /
  5680 dependencies with no violations; 63 script tests; UI 127 test files /
  890 tests passed; Turbo 34/34 tasks, 31 cached.
  Log: `.probe-product-ui-check.log`.
- Production desktop bundle exited 0. Its existing
  `@mete/cli/package.json` require.resolve externalization warning remains;
  no build errors. Log: `.probe-product-ui-bundle.log`.
- The first combined Electron attempt passed the empty/search/model/navigation
  assertions and reached layout checks, then stopped because `.mete-chat-details`
  matched both Run history and diagnostics. This was a test-locator failure,
  not proof of an application defect or a complete layout pass.
  Log/trace: `.probe-product-ui-e2e.log`, `.probe-product-ui-e2e/`.
- The selector was scoped to the diagnostics summary without removing its
  closed-state assertion. Only this test was rerun, with retries disabled:
  `pnpm --filter @mete/desktop test:e2e conversation-discovery.e2e.ts --workers=1
  --retries=0 --trace=on --output=../../.probe-product-ui-e2e-final`.
  Result: 1/1 passed, 24.5 seconds total. One application session per attempt;
  both attempts occurred only in final validation, never during implementation.
- Final `pnpm check` after the test-selector edit exited 0: 34/34 Turbo tasks,
  33 cached. Log: `.probe-product-ui-final-check.log`.
- The successful scenario retains an unsaved Settings draft through searches;
  follows automatic and long unlisted preferences with real scripted fallback;
  switches conversations without leaking the previous preference; checks
  message focus, Send reachability and closed diagnostics. Six theme/viewport
  combinations cover Light, Dark and High Contrast at 700x900 and 1366x900.
  Geometry includes center/edge hit tests; every axe scan returned zero
  serious/critical violations. Six screenshots and the trace are under
  `.probe-product-ui-e2e-final/`. Main visually inspected all three narrow
  captures and the wide Light capture.
- After cleanup, no test Electron/METE/Playwright process remained. Global
  `mete.db` and `settings.yaml` SHA-256 values match the preserved baseline.
  All workers are closed.

## Remaining Boundaries

This is not installed-app, signed-update, Linux, live-provider, full
screen-reader, live Turkish-locale or human usability acceptance. Automated
Turkish label/resource checks do not replace testing the whole translated app.
The captured sidebar has a partly clipped New run control in its scrolled
conversation state; its cause and layout correction are outside U3-U5 and
remain open, not hidden by this batch's passing assertions.

No full release check, installer replacement or public download was attempted
in this batch. The previous interrupted release and remaining security work
remain open. G-D's next behavior decision is proposed separately in
`docs/superpowers/specs/2026-11-08-verification-evidence-design.md`; no new
gate semantics, runtime skills or personal-vault implementation is implied.
