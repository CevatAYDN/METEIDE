# Parallel task-control verification

Date: 2026-11-07
Baseline: `ac41090712762cb3eb7849e836b7449985947706` plus the existing dirty
ADR-180/F1-F7/P1/P3 implementation. Existing unrelated work is preserved.
Scope: ADR-181 and the approved bounded S5-S8 continuation, with S1-S12 integration.
Status: Implemented and verified for the recorded Windows source/unit/Electron scope.
No commit, push or release is authorized by this report.

## Implemented Scope

- Additive `tool.isolation@1`, `policy.requests@1` and `task.control@1` contracts.
  Protocol 30 and the two task-wait event schemas leave old message shapes intact.
- Native file writes require verified adapter identity and independent canonical
  roots. Unknown effects remain exclusive; model/tool preparation uses the same
  bounded scheduler slots.
- Exact policy requests retain server-owned arguments. Human answers carry only
  run/task/request identity and a permitted decision. Once/task grants cannot
  bypass deny, taint or audit failure.
- Persistent human/policy/merge waits, active-run answers, coordinator conversation
  suspension and serialized run-control turns preserve peer snapshots.
- Setup is checkpointed and tracked durably. A restart expires process-local
  policy identities; interrupted setup requires explicit feedback before retry.
- The desktop shows authoritative task rows with busy/error states and exact
  actions. Old navigation/fetch responses cannot retarget a button; ended runs
  remove old controls. No task action writes persistent permission settings.

## Independent Review

Astra found two worktree-confinement defects during review: hard-linked targets
could change another tree, and deleting an outside symlink could validate its
inside target but remove the outside entry. Sol added shared execution/inspection
guards and 11 real filesystem regressions. The lead's focused tools group passed
42 tests; Astra's source/assertion re-review closed both findings.

This is not an OS sandbox or a claim of atomic protection against another process
altering filesystem topology between syscalls. Direct injected permission/I/O
failure cases beyond the recorded suite remain a separate coverage limit.

The subsequent review found checkpoint-provenance/allocation gaps, a stale-team
overwrite of a peer's in-flight marker, permission consumption before a failed
durable save, verification overlapping a writer, and two setup-order/recovery
gaps. Corrections capture exact composition-attested checkpoint implementations,
queue allocations in core across replacement, re-read current team state after
awaits, persist wait removal before granting, keep verify gates exclusive, and
persist pending setup with the initial task opening. Focused regressions for the
first corrections passed; all three atomic-opening cases passed in the final check.
The guardrail path had the same stale-snapshot hazard as automatic acceptance;
submission now validates ownership and rereads the current team after verification
before applying repairs. Its regression checks an actual repair and the peer marker
in both live state and SQLite. Astra's final bounded source/assertion re-review
closed every finding in this review sequence, with no residual actionable issue.
That review did not execute tests and is not a blanket whole-repository verdict.

## Recorded Checks

| Check | Result so far |
| --- | --- |
| Contracts build | Exit 0 |
| Contracts tests | 246 passed; four old protocol/catalog expectations failed, then the three failed files passed all 52 tests after updating expected protocol 30 / 34 methods / 48 events |
| Native tools/checkpoint group | 6 files, 40 tests passed |
| Confinement correction group | 5 files, 42 tests passed, including all 11 new link regressions without skips |
| Security package | 14 files, 114 tests passed |
| Core control foundation | 18 passed; one invalid fixture lacked required capabilities; fixture corrected |
| Core concurrency/control flows | 7 files, 28 tests passed |
| Core setup/recovery/checkpoint group | 6 files, 30 tests passed, including same-process interrupted setup |
| Checkpoint provenance and real Git | 2 files, 5 tests passed; actual per-root checkpoint contents and preserved user index/HEAD |
| Writer lifecycle/replacement group | 2 files, 24 tests passed |
| Review-correction group | 5 files, 49 tests passed; peer marker preservation, exclusive verify and failed-save grant retry |
| UI build | Initial declaration/optional-field type errors corrected; subsequent build exit 0 |
| UI/translation recheck | 6 files, 47 tests passed; valid fixtures now use UUIDs instead of placeholder identities |
| CLI task/legacy permission group | 4 files, 23 tests passed |
| Production and test TypeScript | Exit 0 in the final integrated check |
| Full `pnpm check` | Exit 0; 34 successful / 34 total, 29 cached; 36.925 seconds |
| Final package results | contracts 250, tools 191, security 114, core 474, CLI 180, UI 701 tests passed |
| Source-built Electron task controls | 1 passed: two exact asks, Beta first, Alpha task grant, final files and unchanged policy; screenshots inspected in three themes at 700/1366 |
| Post-correction Electron flow group | 13 passed initially; the single failed read/grep selector was narrowed to the actual conversation message and its focused rerun passed, covering all 14 scenarios |
| Narrow UI source detector | 3 files scanned, no findings; regex-only, not parsed-page contrast or accessibility acceptance |

Evidence: `.probe-parallel-*.log`. Earlier F/P green checks do not certify these
new changes. No tests were skipped and no schema or acceptance threshold was
relaxed to accommodate an invalid fixture.

The installed `theia nls-extract` command produced no output. English resources
were generated with that installed package's `extractFromFile` and
`sortLocalization` APIs over the 199 source files; it reported zero extraction
errors and all 18 task-control keys. Turkish entries were added manually, and the
resource-key/default-text/placeholder tests passed.

Screenshot inspection found Home still offered ambiguous legacy run actions for
team policy waits. Team inbox rows now open the exact task panel only; the
single-agent action is preserved. Rendering and actual callback regressions were
authored before the correction. Final Electron verification includes this change;
the updated light-wide and high-contrast-narrow screenshots were inspected.

The final integration pass also removed four type/import cycles without relaxing
dependency rules. One old CLI browser test relied on globally positional model
responses, which can target the wrong role under parallel scheduling. Its isolated
test template now serializes those roles; every audit/artifact/PNG assertion stays.
The unmodified shipped parallel SEO template retains its separate request-routed
integration test. Both files passed all seven tests after correction, and Astra
reviewed that fixture adjustment as justified. Explicit overlap evidence comes
from the scheduler tests, not from either SEO fixture.

Electron evidence: `.probe-parallel-electron-flows.log`,
`.probe-parallel-electron-rerun.log`, and `.probe-parallel-desktop-flows/`.
The 14 scenarios cover conversation follow-up, game studio, human approval,
guardrail feedback, best-of-N, file read/grep, local MCP, quota pause/resume,
out-of-order exact task permissions, research, URL validation, command argv,
JSON import and explicit Save and connect. No real model provider was called.

Packaged-app installation, signing/update, Linux/WSL and real-provider acceptance
are separate from these Windows source/unit/Electron checks.
