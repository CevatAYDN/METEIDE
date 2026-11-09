# Team Workflow Recovery

Date: 2026-11-09. Baseline: `c5d02494` plus the existing dirty worktree.
Status: VERIFIED WITH CAVEATS for the bounded Windows source delivery.
Final root checks, 53 scripted Electron scenarios and chaos passed after the
Turkish correction. Manual improvement, S2 activation, the installed application
and release acceptance are not complete.

## Delivered Scope

- Direct team-context Skills, project permissions and Memory actions.
- Explicit Settings routes preserve drafts; translated permission discovery.
- Retained Member/Tasks panels with keyboard navigation and task-row routing.
- Existing task/spawn-default lesson choices grouped under Learning.
- Structured policy rule editing with real inheritance, strict save validation,
  source-read validity, scoped save batches and retained non-reset drafts.
- Comment-preserving YAML updates. Ambiguous commented replacements and unsafe
  alias/tag structures are refused with a source-edit explanation.
- Skill editing resolves the native opaque identity, never a masked display
  path. Watches precede opening; saved edits invalidate previews. Reconnect and
  workspace changes retire pending editor actions.

ADRs: 192 (approved workflow recovery), 193 (native editor-source resolution).
Protocol 37 adds one read-only management request; no tool permission is granted.

## Review Findings

Independent Astra review identified and source-closed:

- A task-row click opened Member instead of Tasks.
- Scope changes could redirect later sections of a save batch into global settings.
- Failed reads could be mistaken for inherited defaults after a scalar edit.
- Basic Reset dropped pending rule drafts outside its scalar reset scope.
- Whole-collection YAML replacement lost comments; a later helper correction
  also retained primitive keys created by YAML's own setter.
- A blanket autonomy notice ignored lower capability overrides.
- Masked display labels could address the wrong skill file.
- Save events during opening and same-folder reconnect invalidation could be lost.

Sol implemented bounded slices; main inspected and integrated actual changes.
No tests, builds, formatting or app launches ran before the development/source
review gate. Subsequent validation repairs retained assertions and thresholds.

## Executed Checks

| Check | Result | Evidence |
| --- | --- | --- |
| Initial `pnpm check` | Failed at Biome; behavioral tests not reached | `.probe-team-workflow-check-1.log` |
| Root check after formatting | Failed on three prior S2 TypeScript typing issues; corrected without changing defaults or issue semantics | `.probe-team-workflow-check-2.log` |
| Production TypeScript | Exit 0 | `.probe-team-workflow-tsc-build-1.log` |
| First behavioral root run | UI: five failures from a text-node test walker, search expectations and an old label; assertions corrected to actual documented behavior | `.probe-team-workflow-check-3.log` |
| Focused UI regression rerun | Exit 0, 63/63 tests | `.probe-team-workflow-ui-repro.log` |
| Full `pnpm check` | Exit 0; 34/34 tasks, zero cached, 2m14.607s | `.probe-team-workflow-check-4.log` |
| Desktop production bundle | Exit 0; browser/node/electron targets reported zero errors | `.probe-team-workflow-bundle.log` |
| Mechanical design detector | Exit 0, `[]`; not visual acceptance | `.probe-team-workflow-design.log` |
| Initial Electron subset | Three passed: S1 management/restart/disable, advanced team editing, native skill edit/reapproval/restart. Team permission scenario stopped on a locator ambiguity | `.probe-team-workflow-e2e-1.log` |
| Team scenario second attempt | Failed because the assertion searched text instead of the task-title input value; corrected to the actual labeled textbox | `.probe-team-workflow-e2e-2.log` |
| Team scenario third attempt | Exact wrapped-textarea label did not match; a read-only live accessibility/DOM inspection identified the real textbox name. Changed the test to role/name targeting, without raising timeout | `.probe-team-workflow-e2e-3.log` |
| Team scenario fourth attempt | Found an actual light-theme contrast defect in the workspace-origin badge; changed its text to the theme foreground | `.probe-team-workflow-e2e-4.log` |
| Team scenario fifth attempt | UI approval produced the file; exact bytes differed under host Git `core.autocrlf=true`. Added the repository's LF rule to the isolated fixture, retaining exact byte assertions | `.probe-team-workflow-e2e-5.log` |
| New live workflows | Exit 0, 2/2: scoped policy save, task/keyboard/draft navigation, exact Allow once, merged file bytes, native skill edit/reapproval/restart | `.probe-team-workflow-e2e-6.log` |
| Full desktop regression | Exit 0, 52/52 scenarios, 14.4m | `.probe-team-workflow-e2e-full.log` |
| Turkish acceptance, first two attempts | Exact permission command not found after the native language switch; the speculative late-localization helper did not resolve it | `.probe-team-workflow-turkish.log`, `.probe-team-workflow-turkish-2.log` |
| Turkish diagnosis | Translated command labels observed in the real palette. Installed Theia `filterItems` independently fails to match the complete dotted-I label against itself; lowercase query also fails | `.probe-team-workflow-turkish-diagnosis.log`, its trace attachment, local installed-source reproduction |
| Turkish correction build | Production TypeScript exit 0; desktop bundle exit 0 in all three targets; focused Biome exit 0 | `.probe-team-workflow-turkish-fix-build.log`, `.probe-team-workflow-bundle-4.log`, main command results |
| Turkish live workflow | Exit 0, 1/1 in 24.2s; native language switch, complete permission command, policy save, Tasks/Learning and Skills controls | `.probe-team-workflow-turkish-3.log` |
| Final desktop regression | Exit 0, 53/53 scenarios, 15.4m; includes Turkish and every previous scenario | `.probe-team-workflow-e2e-final.log` |
| Final chaos check | Exit 0, 1/1 scenario, 15.32s | `.probe-team-workflow-chaos-final.log` |
| First final root attempt | Stopped at formatting of the generated input-hash JSON only; artifact formatted, no application change | `.probe-team-workflow-check-final.log` |
| Second final root attempt | TypeScript, dependency checks and prior packages passed; UI collected 1200 passing tests but its status-command suite failed importing the browser-only native palette base without a DOM | `.probe-team-workflow-check-final-2.log` |
| Command fixture correction | Added the native-base fake/prebinding following existing browser-service fixtures, plus a real replacement/singleton assertion; no existing assertions removed. Focused 26/26 and file Biome passed | `.probe-team-workflow-palette-fixture.log`, main command result |
| Final root check | Exit 0; 34/34 tasks, zero cached, 2m10.723s; UI 1209/1209, including filter 17/17 and command binding 9/9 | `.probe-team-workflow-check-final-3.log` |

The full root check used scoped `TURBO_CONCURRENCY=1` and `TURBO_FORCE=true`.
No concurrency configuration, timeout, coverage threshold or lint rule was relaxed.
The installed turbo 2.11.8 documentation was checked first.
The final root run independently executed the new filter tests and corrected
command suite. Two pre-existing non-Windows filesystem cases remain skipped on
Windows; native Linux acceptance is still open.

Final `pnpm check` summary:

```text
Tasks:    34 successful, 34 total
Cached:    0 cached, 34 total
Time:    2m10.723s
```

The normal first bundle step refreshed its pinned Electron ffmpeg library and retained
the existing `@mete/cli/package.json` externalization warning. No new dependency
or editor plugin was installed; the existing built-ins were present.
The contrast-fix rebuild passed all three targets and reused the cached codec
library (`.probe-team-workflow-bundle-2.log`).

Main visually inspected all twelve permissions/team captures from the fifth
attempt: Light, Dark and High Contrast, each at 1366x900 and 700x900. The sixth
attempt repeated those measurements with the final fixture: no panel horizontal
overflow and zero serious/critical axe findings in the sampled states.

The Turkish failure comes from the installed fuzzy matcher comparing the
lowercase string with the original string length: capital dotted I expands
when lowercased. The speculative command-localization wrapper and its import
changes were removed. The bounded correction reuses native filtering on
comparison copies and maps highlights back to the original labels. Native
command visibility, enabled state, handlers and English aliases are retained.
The exact full-label live assertion is unchanged and now passes with the ordinary
native command definitions. Sol's 17/17 focused filter tests were independently
rerun successfully by the final root check.

Independent Astra review found no actionable issue in the filter helper,
integration, regression assertions or Turkish scenario. It inspected the raw
bundle and live-test logs, without independently running those commands or
visually auditing their screenshots.
The same reviewer also checked the isolated command-test fixture correction:
the METE subclass and container wiring remain real, existing assertions remain,
and the native browser base is covered separately by Electron.

Main visually inspected all six Turkish captures (permissions, team and Skills,
1366x900 and 700x900). Each sampled state passed panel overflow and serious/critical
axe checks. The native menu bar still shows some English labels; this is METE
panel acceptance, not full-shell Turkish acceptance.

The desktop validation input record covers 388 changed executable/configuration
files against baseline `c5d02494f65abd3709ecd8c559b8fb5dfde43d4b`:
SHA-256 `f2a99dee7173e10707f5eafeb2b71c97454f24f4015a50419b871649b60b076a`.
Record: `.probe-team-workflow-final-inputs.json`. The complete 53-scenario
Electron rerun and chaos passed. The root-check fixture correction changes only
`packages/ui-theia/test/status-command.test.ts`, not application or Electron
test code. Its new record covers 389 files:
SHA-256 `c38855452509e151d76ad4c1f5a834a0cbd647e39f62530ec4d01aea7083c8d5`,
`.probe-team-workflow-final-inputs-2.log`. The final root check passed against
that tree. The post-check identity is recorded in
`.probe-team-workflow-final-recheck-2.log`.

The user-profile database and settings SHA-256 values matched before and after
the isolated desktop/chaos checks. No owned Electron fixture process remained.
Evidence: `.probe-team-workflow-profile-before.log` and `-after.log`.

## Remaining Boundaries

- The new permission/file-output and edit/reapproval workflows passed in the real
  renderer with scripted models. This does not certify every UI route.
- The existing narrow status-bar clipping and transient native Save toast overlap
  remain visible outside the bounded panel checks. Overall UI polish is not
  declared complete.
- Turkish METE panels, the full Electron rerun, chaos and final root check passed.
  The root check was explicitly package-serial and forced uncached; default
  cold-parallel timing stability is not asserted.
- Native menu-bar translation, hidden/disabled/context-gated command behavior,
  history limits/clearing and painted highlight positions were not individually
  exercised by the Turkish scenario; relevant command semantics were source-reviewed.
- A saved lesson choice is not proof of learning. No model fine-tuning or
  automatic quality improvement was implemented or claimed.
- I0's concrete manual improvement proposal contract is proposed in
  `../superpowers/specs/2026-11-09-manual-team-improvement-design.md`, not implemented.
- S2 runtime activation handlers remain unfinished. Its ordered-prefix defect
  and previously orphaned C3 transport schemas were corrected and reviewed,
  but a selected/approved skill is not claimed to have been loaded into a model.
- Real-provider output quality, installed EXE update, signing, release and native
  Linux acceptance are not implied. No commit, push or publication occurred.
- Tests use isolated data and scripted providers, not the user's provider keys.
