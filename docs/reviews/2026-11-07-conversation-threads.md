# Persistent conversation verification

Date: 2026-11-07
Decision: ADR-182, user-approved C1-C3 continuation.
Baseline: ac410907 plus the preserved ADR-180/181 changes.
Status: Implemented and verified in the recorded Windows source/unit/Electron scope.
No commit, push, dependency installation or real-provider call.

## Delivered scope

- `conversation.thread@1` and protocol31 provide strict idempotent start/reply,
  local paged search and ordered retained-run reads. Legacy ports retain their
  message shapes and behavior.
- Core commits the run, membership and receipt together, retains immutable
  predecessors and rejects stale heads or mismatched request replays.
  Legacy runs remain separate; deletion cannot resurrect a consumed receipt.
- The sidebar groups explicit turns into one conversation, searches locally and
  keeps team runs separate. Historical turns remain inspectable and offer a
  return to the head; per-run removal and existing task controls remain available.
- Uncertain sends retain their full original intent. Exact receipt retry is
  separate from admission of a new message and reports selection-scoped errors.
- C4-C5 attachments, thread rename/archive/fork, whole-conversation deletion,
  authentication setup and Phase 6 are not included.

## Ownership and sizing

Astra lead owned contracts, daemon, integration, documentation and execution.
Sol workers owned core and ui-theia; a separate Astra reviewer inspected the
atomicity, identity, deletion, masking and retry paths without running tests.

The original per-slice estimates were exceeded: the core handoff reported
1,744 changed lines across five concerns, including extraction and tests; UI new
files were 127/367/341/431 lines before existing-file wiring. These are recorded
as estimate misses, not represented as compliant 300-line patches. Review
corrections were separate bounded concerns. File/function/complexity limits remain
enforced by the unchanged checks. No unrelated dirty work was reverted.

## Findings and corrections

The review identified and source-checked corrections for:

- Raw invalid-parameter diagnostics exposing unknown secret-bearing property names:
  the new daemon routes use a constant validation message.
- A late workspace read restoring a cancelled/deleted queued admission: admission
  now has a live owner, cancellation signal and tracked loop; late completion
  cannot upsert or launch a no-longer-admitted run.
- Known preparation failure leaving an inert queued receipt: it settles visibly
  without model execution and without losing the receipt.
- Lost reply responses becoming unretryable after head advancement: the entire
  original payload can be replayed independently of the current composer head.
- Non-selected member changes leaving stale history: same-workspace run events
  refresh thread authority without retargeting the selected run.
- Masking races matching removed messages: message ownership is captured with
  membership and retained matches are revalidated before return.
- Pagination stopping after invalidated matches and retry buttons discarding
  refusal feedback: collection continues after filtering, and the actual button
  callback has an error-state regression.

Independent review is bounded source/assertion review, not a whole-repository
security or release certification.
The reviewer closed every reported source finding and the queued-crash evidence
gap after inspecting the corrections and lead-run logs. No review finding remains
open within that bounded scope.

## Executed evidence

| Group | Result |
| --- | --- |
| Contracts and legacy boundary | 5 files, 41 tests passed |
| Initial core/thread/legacy group | 9 files, 43 tests passed |
| Composed daemon plus legacy conversation | 2 files, 5 tests passed |
| UI state, navigation and bridge | 11 files, 80 tests passed |
| Admission cancellation/preparation correction | 4 files, 12 tests passed |
| Search/deletion/pagination correction | 1 file, 7 tests passed |
| Retry-button error and intent state | 2 files, 8 tests passed |
| Queued crash images | 1 file, 2 tests passed |
| Board member-event regression after stable component selection | 1 file, 8 tests passed |
| Production and test TypeScript | Exit 0 in the final integrated check |
| Production Electron bundle | Exit 0; existing require.resolve externalization warning remains |
| Electron compact composer and exact team controls | Passed in initial four-scenario group |
| Electron existing conversational follow-up | Passed after targeting the diagnostic details by its summary, not every details element |
| Electron two-turn/search/history/process restart | Passed, 43.6 seconds, after opening the restored hidden sidebar through the existing Open home command |
| Final refreshed Electron batch | 2 passed, 39.9 seconds: process restart/search/history in the final UI and existing team approval |
| Final visual inspection | All six final screenshots inspected: light/dark/high-contrast at 700/1366; no incoherent overlap observed |
| Source design detector | Four files, no regex findings; parsed-page rules did not run. Electron axe check passed at the final high-contrast narrow viewport |
| Final pnpm check | Exit 0: 34 successful / 34 total; 27 cached; 57.138 seconds |
| Final package results | contracts 256, core 498, CLI 183, UI 722 tests passed |

Queued-crash tests capture the committed SQLite image before the first event and
while a context read is held, then open a fresh SQLite connection and engine with
the same workspace identity. They assert one retained membership/receipt/run,
paused recovery, unchanged replay ids, changed-payload rejection, zero implicit
tool/model execution and one explicit resume on the same run. This is a captured
database-image test, not a physical power-loss test.

The first Electron restart failure was diagnosed with a screenshot and captured
body text: the restored sidebar was hidden, not an empty visible result. The test
now opens Home as a user would; no data/count/history assertion was removed.
The screen captures were also used to correct the misleading empty Runs label:
the separate list is now explicitly Team runs.

Logs are `.probe-threads-*.log`; final screenshots are in
`.probe-threads-electron-polish/`. Five distinct Electron scenarios passed across
the recorded batches: compact composer, legacy conversation follow-up, exact team
permissions, thread restart/search/history, and team approval. Tests use real local storage/daemon/desktop
components with scripted model responses, never real model providers.

## Limits

Legacy search is title-only because old rows lack an authored-message index.
Thread summaries are metadata reads, not a claim that every historical snapshot
is parseable. Changed filesystem/profile/provider conditions can still require
ordinary explicit recovery. Source-built Windows acceptance does not establish
Linux/WSL, packaged-install, signing/update or real-provider release acceptance.
