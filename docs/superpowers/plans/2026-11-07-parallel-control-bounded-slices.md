# Bounded continuation of S5-S8

Status: Approved on 2026-11-07 ("devam et"); implemented and verified in the recorded Windows scope.
Date: 2026-11-07
Parent: `2026-11-07-parallel-control-implementation.md`
ADR-181 remains accepted. This split adds no capability, feature or dependency.

## Historical Size Audit

Counts are additions plus deletions isolated to this continuation, not the
repository's pre-existing dirty diff. Worker reports were inspected; their whole
working-tree diffs must not be used as if every line belonged to this turn.

| Work | Current changed lines | State |
| --- | --- | --- |
| S2 policy contracts / task contracts | 221 / 282 | Implemented in two sequential slices; not tested |
| S3 native file confinement | 298, before lead's small module wiring | Implemented; not tested |
| S4 checkpoint queue | 281 | Implemented; not tested |
| S5 worker continuation | 428 | Partial; missing lifecycle regressions |
| S6 security continuation | 709 | Implemented; not tested; groups exceeded the intended bound |
| S10 daemon / legacy routing | 232 / 233 before formatting; legacy approximately 301 after formatting | Implemented sequentially; core port is not yet registered |
| Lead checked-chain helper/tests | 250 new lines plus bounded steps integration | Implemented; not tested |
| Lead control-turn helper/tests | 118 new lines plus two type-wiring lines | Implemented; not connected to the driver |
| Lead task-wait schema/test | 114 new lines plus three schema-wiring lines | Implemented after restoring test-first order |

No larger slice is accepted as verified merely because its files exist. The
task-control application, answer handlers, pending collection and driver/engine
wiring that preceded regressions were removed. All unrelated and worker-owned
changes were preserved. The user approved this split before the current
continuation resumed.

## Approved Execution Order

Each row owns one package concern and has a roughly 300-line ceiling, including
tests. Rows sharing a file run sequentially under one owner; they are not parallel
assignments. Existing implementations are reviewed against tests authored first;
missing regressions precede corrective production edits.

| Slice | Owner / package | Exact scope | Size |
| --- | --- | --- | --- |
| S5-A | Lead / core | `prepared-tool.ts`, its test, captured-chain branch in `steps.ts` | about 280 |
| S5-B | Sol / core | `worker-checkpoint.ts`, writer invocation in `worker-tool.ts`, durable-write tests | at most 300 |
| S5-C | Sol / core | Writer eligibility and exclusivity in `parallel-scheduler.ts`; root/setup/slot tests | at most 300 |
| S5-D | Sol / core | `recovery.ts`, multi-worker uncertain-write recovery tests | about 120 |
| S5-E | Sol / core | Pause/cancel/approval/late-result regression completion and bounded fixes | at most 300 |
| S6-A | Sol / security | Exact request identity store plus first basic store tests | at most 300 |
| S6-B | Sol / security | Cross-agent, args, stale mask, replay and taint store regressions; bounded fixes | at most 300 |
| S6-C | Sol / security | `policy-check.ts` request hooks and checker tests | about 200 |
| S6-D | Sol / security | `module.ts` registration and module boundary tests | about 120 |
| S7-A | Lead / core | Task-wait schema, signature and persistence tests | about 120 |
| S7-B | Lead / core | Pending collection/read, mask/replacement races; tests first | at most 300 |
| S7-C | Lead / core | Exact answer validation, wrong run/task/attempt, duplicate answers; tests first | at most 300 |
| S8-A | Lead / core | Per-run control queue and driver/wakeup integration | at most 300 |
| S8-B | Sol / core | Human approval/clarification waits and independent task scheduling | at most 300 |
| S8-C | Sol / core | Exact policy-tool waits, two simultaneous asks and out-of-order answers | at most 300 |
| S8-D | Sol / core | Reviewer/best-of-N continuation through waits | at most 300 |
| S8-E | Sol / core | Verify/setup waits and targeted retry | at most 300 |
| S8-F | Sol / core | Merge waiting/retry while independent work continues | at most 300 |
| S8-G | Lead / core | Core port registration, quiescence, cancel/restart expiry and integration tests | at most 300 |

S9, S10, S11 and S12 remain the approved parent-plan stages. S10's two bounded
concerns remain separate. S11 must likewise be sized before dispatch. Shared
contracts and events are already additive, so no task silently edits another
package's public API.

## Verification Order

1. Finish each coherent implementation group before running its tests.
2. Run focused contract/tools/security/core checks on scripted or local fixtures.
3. Independent Astra review of confinement, grant identity and concurrency.
4. `pnpm check`, then the relevant offline Electron task-control workflow.
5. Repeat only failed paths during correction; report source/unit/runtime/release
   evidence separately. No skipped assertions, real providers, commit or push.

Worker identities (reused after approval, with disjoint package ownership):

- S2/S6: `01a1b59a-6a12-7750-9176-214bdc530a29`
- S4/S5: `01a1b59a-966c-7a93-92b7-63fd09f80a58`
- S3/S10: `01a1b59b-2c80-77f3-9298-28002dfa5a60`

## Historical Execution

- S5-B/C/D/E: Sol worker resumed; remaining writer lifecycle and fallback regressions.
- S6-A/B/C/D: corrective source pass complete; focused tests and independent Astra review pending.
- S7-B/C: tests authored first, exact pending/answer runtime implemented; integration checks pending.
- S8-A/B/C: active-control and two-policy-ask tests authored first; driver/domain integration in progress.
- S11-A/B/C/D: Sol owns sequential UI RPC, session, view and wiring slices, each approximately 300 lines.
- Shared contracts compiled successfully. First contracts batch: 246 passed,
  four old protocol/event-catalog expectations failed and were updated to protocol
  30 / 34 methods / 48 event types; failed-path rerun pending.
- Native tools group: 6 files, 40 tests passed, including real Git checkpoint
  allocation and worktree confinement/escape regressions.
- Tests run serially by the lead because the Windows Vitest cache is shared.

## Final Continuation

The approved slices are implemented and the final `pnpm check` exited 0 with
34/34 successful tasks (29 cached). Sol owned bounded contracts/security/tools,
writer/setup and UI changes; Astra lead integrated and ran checks; the independent
Astra reviewer closed every reported confinement/concurrency finding at the
source/assertion level. No worker verdict is substituted for executed checks.

The native checkpoint callback is witnessed at composition; core serializes
allocations across adapter changes and resumed drives. Exact permission answers
persist their wait transition before consuming a grant. Scheduler/coordinator
updates preserve peer in-flight markers, verify/setup are exclusive, and initial
setup state is part of the task-opening save. Four import cycles were removed
without disabling architectural checks.

Final evidence and exact check counts are owned by
`../../reviews/2026-11-07-parallel-control.md`. Windows Electron covered all 14
selected scenarios, including task decisions in three themes and two widths;
only the failed read/grep selector path was rerun. Packaging, real-provider
acceptance and Linux/WSL remain outside these verified claims.
