# IDE follow-through verification

Date: 2026-11-07
Baseline: `ac41090712762cb3eb7849e836b7449985947706` plus the uncommitted
ADR-180 usability foundation. Existing unrelated changes are preserved.
Scope: approved F1-F7, then P1-P5. No commit, push or release is part of this pass.

## Implemented

- F1: authored offline VSIX fixture and full install/activate/disable/enable/remove
  regression. Disabled extensions retain their local display metadata without a
  startup registry request.
- F2: one compact composer with model, tool selection and Start together.
  The Electron scenario covers long input, keyboard submission, 700/1366 widths
  and light/dark/high-contrast themes.
- F3: a single Connect / Retry / Save and connect action. Disk-read failures
  cannot masquerade as an empty list; stale reads cannot overwrite edited drafts;
  saving invalidates every old connection probe.
- F4: native edit/save/search/terminal/SCM and METE diff navigation.
- F5: discoverable advanced review/verify/best-of-N controls. Unsupported options
  are labeled inactive. Capability gates and unknown YAML fields retain their
  order and contents through command edits.
- F6: real local Node breakpoint, variable, step and continue scenario.
- F7: real task failure, problem matcher, source navigation and successful rerun.
  The failing scenario exposed a Theia 1.76.0 defect: cached last-task reruns skip
  normal marker cleanup. The pinned package patch calls the existing owner-scoped
  cleanup before rerun; no dependency version was changed.
- P1: known query tools share the bounded worker slots with model calls. Results
  retain task/agent/cwd/taint identity, budget reservations remain shared, and pause
  drains successful peers even if another settlement fails.
- P3: final-approval order is persisted for worktree merges. A failed queue head
  survives restart/retry; old snapshots retain template-order fallback.

## Safety Review

Sol implemented the bounded UI/core slices; Astra owned integration and independent
review. The targeted final scheduler review found no remaining actionable finding
in query admission, independent drain settlement or the run-driver error boundary.
This is source-review evidence, not a substitute for tests.

P2 is not implemented: a separate worktree does not establish that an adapter uses
it, and mapped adapters can resolve the main workspace. The unsafe parallel-writer
draft was removed. Vault appends, screenshots, audits, raw MCP and unknown effects
remain exclusive rather than being classified by the checkpoint flag.

P4/P5 are not implemented: the existing run-level allow port cannot identify two
pending task-specific requests. See the proposed, unapproved
`../superpowers/specs/2026-11-07-parallel-safety-decisions.md`.

## Verification

| Check | Result |
| --- | --- |
| `TURBO_CONCURRENCY=1 pnpm check` | Exit 0: 34/34 Turbo tasks, 27 cached; Biome 1108 files; no dependency violations in 1317 modules / 4606 dependencies |
| Final check after the terminal helper correction | Exit 0: 34/34 tasks, 33 cached; unchanged package tests reused this pass's results |
| Core / CLI / ui-theia | 404 / 167 / 675 tests passed; the core merge-retry fixture uses real engine/SQLite state and a fake VCS failure |
| Production desktop bundle | Exit 0; browser, Node and Electron bundles have zero errors |
| Integrated source-built Electron | 16/17 passed in 4.3 minutes; the sole failure was a terminal test-helper command mismatch |
| Failed native workflow only | Exit 0: 1/1 passed in 15.7 seconds after selecting the explicit terminal-profile command |
| Three-theme composer | 700/1366 actual viewport widths, long input, visible controls and keyboard submission passed; captures visually reviewed |
| Tool setup / advanced team | Saved/pending/connect states, URL/command/JSON drafts and advanced save/reopen passed |
| Native IDE | VSIX lifecycle, edit/search/terminal/SCM, Node debugger and task/Problems/source/rerun passed |
| Four template scenarios | Research, SEO, web-dev and game-studio passed on scripted providers; the fixture game was played in Electron |
| Screen accessibility / CSP | The all-screens Electron test passed without serious/critical axe findings or matched CSP refusals |
| Impeccable, changed F UI files | Exit 0, `[]`; a static scan, not blanket runtime accessibility proof |
| `git diff --check` | Exit 0 at the final implementation review |

These are 17 distinct passing scenarios across the initial batch and one targeted
rerun, not a claim that the initial batch passed 17/17. No test was skipped and no
acceptance threshold was lowered. The bundle retains the existing
`require.resolve("@mete/cli/package.json")` warning; daemon-backed flows passed.

Logs are `.probe-ide-follow-through-{check,final-check,bundle,electron,native-recheck,design}.log`.
The batch captures are preserved in `.probe-ide-follow-through-evidence/`; the
targeted native workflow capture is in `.probe-ide-follow-through-native/`.
These are ignored local artifacts. All test profiles and workspaces are temporary,
and scripted model/web/browser adapters replace real providers. Installed task
version 1.76.0, runtime rerun cleanup and the included EPL license were checked.

Earlier failing checks were retained as evidence, not hidden:

- The scheduler repeat-guard test awaited an exact transient model-request count.
  It now awaits the three actual persisted tool results; denial, repeat warning,
  taint progression and peer-isolation assertions are unchanged.
- The CLI SEO fake answered global call positions, which no longer belong to a
  fixed task after query overlap. It now selects responses from the request's
  offered tools and prior tool calls. Report, tool and fallback checks remain.
- Native test helpers now select the actual palette option, retain the go-to-line
  prefix and type through Monaco. These were harness fixes, not product defects.
- The final native workflow test requested Create New Terminal but expected the
  separate profile-selection command's picker. The captured UI already held a
  working terminal. The test now requests the explicit profile command; terminal
  output, saved marker content, SCM diff and source navigation checks remain.
- The native last-task test failed after a successful rebuild because its old
  Problems entry remained. It passed against the patched bundle, with the original
  zero-markers assertion intact.

Source checks, source-built Electron workflows, packaged application acceptance,
real-provider runs, Linux validation and release approval are separate. This pass
does not claim full reference-IDE parity or close the Phase 5 release gate.
