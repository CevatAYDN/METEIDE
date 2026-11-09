# Skill Activation Implementation

Date: 2026-11-08, Europe/Istanbul.
Status: approved for implementation; development started, final tests pending.
Owner: main Astra lead; coding owner `lead_code` / GPT-6.1 Sol.
Independent reviewer: `lead_review` / GPT-6 Astra.
Chat: `01a1bc34-f67a-7852-9f3a-2a3af09710a4`.

## Approval And Baseline

The user approved the S2 scope and revocation principle with "evet devam et".
The user requested the next work after receiving the
[concrete specification](../specs/2026-11-08-skill-activation-design.md) and
[ADR-190](../../adr/190-skill-runtime-activation-and-provenance.md), accepting
the contract, limits, native attestation and compatibility boundary. Routine
edits within this plan need no repeated approval.

HEAD is `c5d02494f65abd3709ecd8c559b8fb5dfde43d4b`, with extensive existing
tracked/untracked work in main. Preserve it, including S1 and unrelated release,
MCP, verification and UI changes. No commit, push, install or release is authorized.
Phase 5 remains current. Personal vault, graph and Phase 6 work remain separate.

The previous S1 tests are historical evidence, not S2 passes. Development tests
are authored first but never executed while implementation/source review is
unfinished. All validation belongs to the final stage requested by the user.

## Ownership Rules

- One slice owns one package and one concern, around 300 manual changed lines
  including tests. Split before crossing that bound; a row is not a size waiver.
- Main owns shared specifications, ADR status/index, Changeset, integration and
  the final input manifest. Do not mix unrelated dirty hunks into this delivery.
- Sol edits the assigned source and tests directly. At most three agents may
  remain open; no nested agents. Reuse an owner for related corrections.
- Runtime/public schemas land first. Consumers use only public package exports
  and kernel registry capabilities, never another capability module's source.
- A file belongs to one worker at a time. Rows sharing exports, module.ts or
  engine state files run sequentially even when their concerns differ.
- Every brief forbids tests, builds, typechecks, UI launches, provider calls,
  configuration writes, installs and publication until the development gate.
- Main inspects actual diffs and changed assertions. Worker completion means
  implemented, not verified. Native roles are available; no Sol dispatch yet.

## Native Admission Prerequisite

Independent S2 source review identified that S1 `skill-admission.ts` captures
the selected quiesce/engine objects and verifies continuity, but does not attest
their native provenance. Registry bindings can select a replacement before that
capture. This is a static counterexample, not an exercised plugin exploit.

The minimal correction is a composition-owned association of the exact native
engine and its exact quiesce adapter, populated by the core factory. Management
accepts only that registered pair. IDs, trust labels and success-shaped replies
are insufficient. S1 idle/no-engine behavior, cancellation, drain and exact
retirement remain unchanged. Separate core and CLI slices keep their ownership.
No accepted S1 permission or mutation contract is relaxed.

## Package-Sized Sequence

All rows below are approved; current execution status is tracked at the end.
Paths are relative to the repository; worker briefs must supply absolute paths.
New helper filenames are ownership targets, not permission to scaffold unused
abstractions. Keep the existing directory and public-export conventions.

| ID | Owner / package | Files or responsibility | Depends on | Done criterion |
| --- | --- | --- | --- | --- |
| P0-C | Sol / core | `src/module.ts`, module test: native engine/quiesce registration callback | Written approval | Callback names the exact wrapped objects actually registered; reload gets a fresh association |
| P0-T | Sol / cli | `application/skill-admission.ts`, composition-owned native-control helper and admission tests | P0-C | Pretended/replaced gate or mismatched engine cannot admit; no-engine path remains truthful |
| C1a | Sol / contracts | New `domain/skill-runtime.ts`: owner, version, policy and snapshot schemas; focused test | Written approval | Invalid identity, duplicates, byte limits and owner shapes refused |
| C1b | Sol / contracts | Runtime Result/inventory/catalog/load/check interfaces and defaults; focused tests | C1a | Source-independent complete receipt membership; no arbitrary trusted-content input |
| C1-S | Main / contracts | Receipt-free selection check contract and tests | ADR-191 approval | No body, root, owner, receipt or reusable authority |
| C2a | Sol / contracts | New `domain/conversation-skills.ts`, thread @3 inputs and exports | C1b | Ordered exact selection participates in a versioned intent; @1/@2 unchanged |
| C2b | Sol / contracts | New `domain/run-skills.ts`, start/read/evidence contracts and exports | C1b | Exact role/context/attempt ownership and typed block/history states |
| C3a | Sol / contracts | New daemon S2 schemas; `domain/daemon.ts`, protocol tests | C2a/C2b | Protocol 36, strict session-bound sends; no fallback shape |
| C3b | Sol / contracts | `run.skills.updated` schema and event fixtures | C2b | Content-free validated refresh event; main adds docs/07 row with the schema |
| A1 | Sol / security | New `infrastructure/skill-runtime-store.ts`, store tests | C1b | Security-owned global receipts/inventory, no bodies; orphaned payload is not reconstructable |
| A2 | Sol / security | New runtime catalog helper and tests | A1 | Complete eligible masked descriptors; over-budget or missing evidence stays explicit |
| A2-S | Sol / security | Exact-version read-only selection preflight and tests | C1-S/A2 native readers | Full masked aggregate refused before run creation; no preview or receipt |
| A3 | Sol / security | New exact-version load helper and tests | A2 | Private native input admission and origin; final source/revision checks; receipt before success |
| A4 | Sol / security | New retained-snapshot checker and tests | A3 | Independent complete inventory; omitted/rebound owner, digest/revision/source refusal |
| A5 | Sol / security | `module.ts`, runtime factory/export wiring and module tests | A4 | Essential security exposes source-independent inventory; no new required capability or startup scan |
| E1 | Sol / core | Domain skill state and snapshot schemas, native context IDs and storage tests | C2b | Genuine legacy behavior retained; marker omission cannot hide global receipts |
| E2a | Sol / core | `thread-intent.ts` and @3 admission tests | E1/C2a | Full ordered policy identity; uncertain exact retry creates no extra work |
| E2b | Sol / core | `thread-mutations.ts`, `begin.ts`, @3 admission helper/tests | E2a/A5 | Queued run commits before load receipts; late/refused load cannot replace/remove the accepted head |
| E3 | Sol / core | New run-skills start adapter and engine wiring/tests | E1/A5 | Explicit template/role validation and new-run marker; legacy ports unchanged |
| E4a | Sol / core | Native loader admission helper and focused tests | E2b/E3/P0-T | Exact process-local pending-call authority, not model-supplied owner or ToolContext strings |
| E4b | Sol / core | Loader snapshot commit/idempotency and tests | E4a | No success before durable owned state; cancellation or stale drive cannot activate a load |
| E5a | Sol / core | New pure skill request-prompt helper and tests | E4b | Correct priority/escaping/order, no body in normal history or tool results |
| E5b | Sol / core | Context budgeting, `domain/compact.ts`, model request integration/tests | E5a | Counts the full pinned block; compaction/retry never drops or replaces it |
| E6a | Sol / core | Resume/recovery guard and tests | E5b/A4 | Disabled revision cannot manual/auto-resume, even after same-byte reapproval |
| E6b | Sol / core | Ordinary tool/verification/continuation guards and tests | E6a | Pending actions cannot bypass a revoked loaded context |
| E7a | Sol / core | Task/attempt activation and retained history tests | E6b | Model fallback/revision retain identity; fresh attempts do not inherit loaded authority |
| E7b | Sol / core | Parallel worker and coordinator integration/tests | E7a | Late results, cancellation and peer drain preserve correct ownership; no reviewer/judge leakage |
| E8 | Sol / core | Authoritative `run.skills@1.read`, event refresh and tests | E7b/C3b | Failed/missing records are not empty success or invented loaded evidence |
| K1 | Sol / testing | New runtime contract kit, then core usage kit if separately required | C1b/C2b/A5/E8 | Native and scripted adapters share the required interface/error invariants |
| T1 | Sol / cli | `infrastructure/skill-modules.ts`, composition/attestation and tests | A5/E8/P0-T | Private native load admission and runtime/source/trust attestations; no startup scan or inference |
| T2 | Sol / cli | New S2 daemon routes, request mapping and tests | T1/C3a | Session/workspace validation, no selection stripping, no active-work mutation replay |
| T3 | Sol / cli | Terminal new-start routing and composition acceptance tests | T2 | New native starts use S2 auto; legacy saved resume retains its marker semantics |
| U1 | Sol / ui-theia | New S2 request/session helpers and focused tests | T2 | Workspace/transport captures, exact intent retry and preserved rejected drafts |
| U2a | Sol / ui-theia | Single-agent selection control and tests | U1 | Mode and source-qualified exact selections in existing composer; keyboard and EN/TR |
| U2b | Sol / ui-theia | Team role selection and tests | U2a | Selections bind existing template roles; unknown/routed target cannot silently reinterpret them |
| U3 | Sol / ui-theia | Loaded/blocked/history view and tests | U2b/E8 | Selection is not load; load is not proof of provider use or compliance |
| D1 | Main | Accepted ADR/spec/index, tabs 06/07/08/10/13, FAQ, Changeset | Written approval and corresponding slices | Docs reflect only implemented approved behavior; no unrelated roadmap cleanup |
| V1 | Main | Isolated desktop acceptance harness, `apps/desktop/e2e/skill-activation.e2e.ts` | U3/T3 | Actual native workflow and restart; scripted provider inspects actual payload; no user data |
| R1 | Astra | Read-only trust, public contracts, concurrency and assertion review | Stable implementation slices | Findings fixed or explicit unresolved blockers, never waived |
| V2 | Main | Final verification/evidence report | All development and R1 complete | Raw command results, tested input identity, live UI evidence and honest remaining gaps |

Contract rows are sequential where exports/defaults overlap. After stable
contracts, the security implementation and contract kit can proceed in disjoint
files; core integration waits for the required runtime contract. UI sessions may
be authored against scripted protocol fixtures while native CLI wiring finishes,
but final integration waits for both. Main never waits on a delegated blocker
when useful critical-path work can be done locally.

## Required Regression Matrix

| Area | Cases that must remain explicit |
| --- | --- |
| Native authority | Replaced-before-capture gate, mismatched engine/gate, replaced runtime/source/catalog/masker, exact new instances after restart |
| Receipt integrity | Changed text plus self-hash, omitted/rebound owner or receipt, removed S2 marker, copied workspace, disabled/reapproved identical bytes, source-independent inventory |
| Source freshness | Ignore update, root replacement, hardlink/symlink/stream rejection, bytes changed while masking, missing/unreadable source, full-inventory overflow |
| Admission | Invalid/stale selection, forged owner/origin input, receipt-only crash refuses reconstruction, abort before/after receipt, exact retained-load vs thread-intent replay |
| Budget | Four vs five distinct loads, complete 65,536-byte text, aggregate overflow, 16,384-byte catalog, wrapper/token accounting, smaller-model fallback |
| Conversation | New reply mode inheritance without body authority, explicitly resubmitted versions, no silent stale-selection update, no old run mutation |
| Compaction | Aged results, forced fold, repeated fold request, large pinned context, exact retained content after daemon restart |
| Continuation | Manual resume, quota/network rearm, pending tool/verification/merge, earlier-attempt revoke, source change during gateway wait checked at next core boundary |
| Team ownership | Distinct same-role tasks, best-of-N attempts, revision and model fallback, stale worker completion, reviewer/judge/clarification exclusion |
| Optional behavior | Source/catalog/trust modules may be absent while essential security supplies receipt inventory. Genuine legacy/no-skill work needs confirmed empty inventory; missing runtime or corrupt/unavailable inventory is never empty. Explicit selections and receipt-bearing runs cannot degrade away. |
| UI | Correct run/context/version, stale workspace/session, uncertain send, failed read, keyboard, EN/TR, three themes and narrow/wide layouts |

Tests use hand-written fetch fakes/scripted adapters and isolated real temporary
files/SQLite where boundary behavior matters. A manually invalidated cache or
fabricated success record is not a substitute for mutating the actual source.
Authored-but-unexecuted tests are not called RED or GREEN.

## Final Validation

1. Stop/close all implementation workers and finish independent source review.
   Record changed source/test/config inputs, including untracked files.
2. Run focused contract/security/core/CLI/UI suites for the new boundary, inspect
   raw results and then run `pnpm check`. No result is assumed in advance.
3. If the known default parallel timing problem recurs, retain its failed log.
   Any forced uncached package-serial check is reported separately, not as a
   default-parallel stability fix. Do not weaken tests, waits or coverage.
4. Run chaos for optional-module behavior, then the desktop production bundle
   and the isolated source Electron scenario after source checks succeed.
5. Inspect actual scripted-provider request payloads and persisted records.
   Exercise explicit/model selection, changed/disabled source, pause/restart,
   actual draft handling, narrow/wide views, three themes and axe checks.
6. Preserve user data; verify the test profile remained isolated. Reconcile
   owned processes and final input hashes. No real provider or account test.
7. Publish the evidence report with actual counts/exits, screenshots and
   outstanding Windows/Linux, native screen-reader, installed-app and release
   boundaries. No new release work is included in this batch.

No validation command above has run for S2. `pnpm check`: NOT RUN.
Implementation is in progress, not done.

## Current Execution

| Slice | Owner | Status | Evidence |
| --- | --- | --- | --- |
| P0-C | Sol / Sagan | implemented | Actual hunks inspected; 130 reported changed lines; tests not run |
| P0-T1 | Sol / Sagan | implemented | Current native pair attestation and CLI wiring; 242 reported lines; tests not executed |
| P0-T2 | Main | implemented as test fixture | Real native drain replaces an unattested synthetic gate; NOT RUN |
| C1a | Sol / Raman | implemented | 334 reported lines including coverage; overage recorded; tests not run |
| C1b.1 | Sol / Raman | implemented | Runtime errors and bounded complete catalog schemas; 243 reported lines; tests not run |
| C1b.2a | Sol / Raman | implemented | Complete global receipt inventory and native load inputs; 249 lines; tests not run |
| C1b.2b | Main | source review complete | Strict runtime port/check/results and metadata-only acknowledgement; tests not run |
| Early review | Astra / Ramanujan | source review complete | No finding in P0-C/C1a; tests still not run; reviewer closed |
| C1-ID | Sol / Sagan | implemented | Exact canonical payload; 245 added lines; no substitution; tests not run |
| R2 | Astra / Ramanujan | source review complete | No actionable finding in stable CLI admission/drain and catalog contracts |
| R3 | Astra / Ramanujan | source findings recorded | Lossy metadata key correction and missing pre-admission sizing route |
| C1-R3 | Sol / Sagan | source finding closed | Lossless map parsing; independent source recheck complete; tests not run |
| C2a | Sol / Raman | implemented | Versioned conversation selections; 242 lines; tests not executed |
| C2b.1 | Sol / Raman | implemented | Exact role selection/start schemas; 211 added lines; tests not run |
| A1 | Sol / Sagan | implemented | Global immutable receipt store; 300 lines; tests not executed |
| C3b | Main | implemented | Content-free refresh event with docs/07 row; tests not run |
| R4 | Astra / Ramanujan | findings recorded | Original-run omission under index corruption; shared defaults; event-count assertion |
| A1-R4 | Sol / Sagan | source finding closed | Correct inventory omission; 171 changed lines; authored regressions not run |
| C2/C3-R4 | Main | source findings closed | Fresh nested defaults and precise event count; tests not run |
| A2-S | Main / security | implemented, focused tests passed | `application/skill-selection.ts`; 13/13 focused tests; root `pnpm check` 34/34. Module registration (A5) still pending |
| A3 | Main / security | implemented, focused tests passed | `application/skill-load.ts` with shared `skill-runtime-evidence.ts`; exact-object admission, pre-commit budget, post-mask grant recheck, receipt before success; 9/9 focused tests on real SQLite store; root `pnpm check` 34/34 |
| A5 | Main / security | implemented, tests passed | `application/skill-runtime.ts` and `module.ts`: essential security registers `skill.runtime@1`/`skill.selection@1`, migrates global receipts, binds the workspace key lazily (no startup scan), fresh lifetime per activation, `NO_SKILL_RUNTIME_ATTESTATIONS` fails closed until T1 supplies native attestations; shared `skill-workspace-key.ts`; security 338/338; root `pnpm check` 34/34 |
| A4 | Main / security | implemented, focused tests passed | `application/skill-check.ts`; independent store inventory first, canonical payload digest, then current source/grant eligibility; 12/12 focused tests on snapshots produced by real A3 loads; root `pnpm check` 34/34 |
| Integration | Main Astra | running | ADR/spec approval recorded; existing dirty work preserved |
| E1 | Main / core | verified (pre-existing) | `domain/skill-state.ts` in run store; `skill-state-store.test.ts` 6/6 executed |
| E2a | Main / core | implemented, tests passed | `thread-intent.ts`: separate `skills.*@3` namespace covering the full ordered policy, fixed field order, reply omission distinct from explicit auto; @1/@2 digests unchanged; 5/5 |
| E2b | Main / core | implemented, tests passed | `skill-admission.ts` (ADR-191 preflight, initial S2 state, mode-only inheritance), `thread-mutations.ts` @3 start/reply, `begin.ts`/`run-machine.ts` S2 marker only with genuine state, gated `conversation.thread@3` in `module.ts`; queued run commits before any receipt; 7/7; core 686/686. Two team/spawn tests failed twice under default-parallel `pnpm check` and passed on rerun and in two forced core runs; failed log not retained |
| E3 | Main / core | implemented, tests passed | `run-skills.ts` adapter and `admitRunSkills` in `skill-admission.ts`: exact template role membership, per-role ADR-191 preflight before any handoff or run, single agent gets one assistant context, team contexts deferred to task attempts (E7a), legacy `team.engine@3` starts unchanged; gated `run.skills@1` in `module.ts`; `read` returns `unavailable` until E8; 7/7. Default-parallel `pnpm check` failed once with `vi.waitFor` timeouts in `spawn-engine` and `verification-shell-metadata` (log retained: `docs/reviews/logs/2026-11-09-s2-e3-parallel-timing.log`); the next unchanged `pnpm check` passed 34/34. Tests and waits were not weakened |
| E4a | Main / core | implemented, tests passed | `skill-load-authority.ts`: process-local map keyed by the exact input object, liveness re-evaluated on every check, throwing probe = retired, stale release cannot remove a newer registration, pre-receipt `fits` against retained count/bytes; `createEngine` exposes `skillLoadAdmission` for T1 to hand to security; 6/6 |
| E4b | Main / core | implemented, tests passed | `skill-loader.ts` (single coordinator over a `SkillLoadHost` port), `skill-host.ts` (live run binding: same `Live`, captured drive token, `running`, not aborted), `domain/skill-context.ts` (pure re-validated next state), `SKILL_LOADED` run event; exact retained version reused without a new receipt; strict runtime result parsing; success only after the durable `apply`; late/paused/stale loads activate nothing; body stays out of ordinary messages; loader 8/8, engine host 3/3; root `pnpm check` 34/34. Not yet a model tool (E5+) |
| E5a | Main / core | implemented, tests passed | `domain/skill-prompt.ts`: request-only escaped `user` message after system and before history; load order kept; subordinate to system rules and the user's request; no role/model/permission/policy/verification change; no name priority, clarify on conflict; `<`, `>`, `&` escaped so a body cannot close the envelope; no receipt/owner/digest repeated; ready catalog as separate metadata; empty when nothing applies; 6/6 |
| E5b | Main / core | implemented, tests passed | `domain/skill-pinned.ts` rebuilds the block from retained snapshots on every request; `toSummarize` counts it but folds history only; `run-driver.ts` inserts it in the model request only; `too_large` folds history and then pauses without dropping the block; single agent only until E7a gives team attempts contexts; 4/4; core 720/720 in three forced runs. Default-parallel `pnpm check` failed once with `vi.waitFor` timeouts in `conversation-mcp-policy`, `scheduler-tools`, `spawn-engine` (log: `docs/reviews/logs/2026-11-09-s2-e5-parallel-timing.log`); the next unchanged `pnpm check` passed 34/34 |
| E6a | Main / core | implemented, tests passed | `skill-guard.ts` `checkRunSkills` sends every retained snapshot of every context to `skill.runtime@1.check`; `guardResume` runs before manual and timed resume and holds the quiescence admission count while awaiting; refusal records `SKILL_BLOCKED`, clears the timer, pauses or `HOLD`s a self-resuming pause as `user`; a later passing check clears the block; missing runtime on an S2 run is `unavailable`, never empty; legacy runs unchecked; 6/6 |
| E6b | Main / core | implemented, tests passed | `skillBoundary` at the start of every driver turn, before the parallel scheduler and before any model, tool, summary or team step; legacy runs return synchronously (no added await); a revoke during a tool call stops the next model call, keeps the completed result in history; shared test fake `test/helpers/skills.ts` uses the contract integrity helper; 7/7 guard, core 727/727 forced. Default-parallel `pnpm check` failed three times on different untouched tests (`scheduler-writing-recovery`, `verification-read`, then the CLI `skill-version-management` 20 s timeout); each passed alone (5/5 runs of the first, 3/3 of the CLI test); logs `docs/reviews/logs/2026-11-09-s2-e6-check*.log`. The second failure stopped once the boundary stopped awaiting for legacy runs. The fourth unchanged `pnpm check` passed 34/34 |
| E7a | Main / core | implemented, tests passed | `domain/skill-seat.ts`: owner of the seat about to call the model; single agent = assistant context; team worker = `{ taskId, attemptId }` of the live attempt (task id for attempt 1, `attempts.id` after, ADR-162), so a model fallback/revision keeps its context and a fresh best-of-N attempt gets a new one; reviewers, answerers, judges and non-S2 runs get none. `pinnedFor` now pins per seat; first load creates the attempt context through `withSnapshot`; 5/5 seat tests |
| E7b | Main / core | implemented, tests passed | parallel worker requests (`worker-call.ts`) and fold sizing (`parallel-scheduler.ts`) pin the task attempt's block; a finder load is pinned to the finder only, never to the writer (1/1 integration); core 735/735 in two forced runs. Default-parallel `pnpm check` failed once more on untouched `conversation-mcp-policy`, `pair-review`, `spawn-engine` |
| Baseline | Main | timing instability is pre-existing | A clean worktree of `c5d02494` (no S2 work at all), `turbo run test --force --concurrency=10` four times: 1/4 passed; failures in `spawn-engine`, `conversation-mcp-policy` and tools `vcs-checkpoint-concurrency`, the same `vi.waitFor` timeouts. Logs `docs/reviews/logs/2026-11-09-baseline-c5d02494-run*.log`. Not caused by S2; not weakened; left for a dedicated fix |
| E8 | Main / core | implemented, tests passed | `domain/skill-read.ts` pure projection + `application/skill-reads.ts`: genuine legacy reads `legacy` without asking security; S2 state, inventory and canonical-digest integrity checked first (a receipt core never retained, missing state or unavailable inventory is an error, never empty); metadata-only summary, bodies only for an exact `contextId`; statuses selected/loaded/blocked/history; authentic history and the block stay readable after revocation; content-free `run.skills.updated` on load and block; `run.skills@1.read` wired; 8/8 read, core 743/743 in two forced runs, `pnpm check` 34/34 on the second run (first failed on baseline-flaky `spawn-engine`, `verification-read`) |
| Model tool | Main / core | implemented, tests passed | ADR-194: `skill_load` offered only to the skill-owning seat of an auto-mode S2 run with a ready catalog (`domain/skill-tool.ts`); catalog fetched once per context and retained (`application/skill-catalog.ts`, `domain/skill-catalog.ts`); a call is answered in core (`application/skill-tool.ts`) only for an exact catalog version, else `bad_input` with no security call; origin `model`; the acknowledgement holds no body; legacy and manual turns stay synchronous; `tool-checkpoint.ts` split keeps `run-driver.ts` under 400 lines; parallel scheduler workers are not offered the tool yet (ADR-194); 3/3, core 746/746 forced, `pnpm check` 34/34 |
| T1 | Main / cli + core | implemented, tests passed | core-engine hands its process-local load admission through `onNativeControls`; `createNativeControls().skillLoads` always delegates to the latest activation and is closed before one; `nativeSkillModules` returns `SkillRuntimeAttestations` (sources, catalogs, trust, admission) that `createSecurityModule({ skills })` receives; real-module composition test: preflight and catalog work end to end, a forged load is `stale` (2/2) |
| T2 | Main / cli | implemented, tests passed | `daemon-skill-runtime.ts` (`skills.runtime`, `run.skills.read`) and `daemon-skill-runs.ts` (`thread.skills.start/reply`, `run.skills.start`) share the existing connection session; the session id is checked then removed, selections are passed through unchanged, an omitted reply policy stays omitted, a stale session never dispatches, a read failure is an error; 5/5 over a real JSON-RPC pipe. `pnpm check` 34/34 on the second run (first failed on baseline-flaky `spawn-engine`, `team-engine`) |

## T3 continuation

The user's subsequent commit/push request supersedes the original no-push
baseline: twelve local commits through `54dba9e3` were pushed to `origin/main`.
Pre-push secret scanning and all 34 cached test tasks passed.

T3 is the CLI default-entry slice; desktop sends remain in U1/U2. New terminal
starts resolve `run.skills@1` without overriding its schema defaults. Resume,
approval and permission answers keep their current ports and saved identity.
The existing real-module edit test now requires an authenticated S2 `auto`
summary, and a missing-port regression refuses instead of calling legacy start.
Both regressions failed before implementation; all 15 `run.test.ts` cases now
pass. The chaos release test also verifies the S2 policy for every omitted-module
set and passed 1/1. Root `pnpm check`: 34/34 passed (29 cached), including
CLI 317/317. The first root attempt stopped on test formatting; formatting was
corrected before the successful run.

## U1a runtime-read transport

Split U1 into bounded steps: U1a connects catalog and authenticated history reads;
U1b will add session-bound sends and exact-intent retries before U2 controls.
U1a reuses the captured `SkillTransport` in the daemon host and exposes
`skillsRuntime` / `runSkillsRead` through the Theia backend service. Inputs and
outputs are schema-validated; run and context identities must match the request.
A replaced transport cannot deliver a late reply. Typed runtime failures remain
distinct from transport failures and valid empty catalogs. Eight focused tests
and nine host tests pass, including the actual fake-daemon JSON-RPC pipe.
Root `pnpm check`: 34/34 passed (31 cached), including ui-theia 1218/1218.

## U1b session-bound sends

S2 start/reply/team-start methods are exposed through the backend. A successful
runtime catalog read captures its session and transport; sends validate input
before dispatch, require that exact workspace/session/process, and never acquire
or replay against a replacement. Reply results must name the requested
conversation. Explicit retry keeps the submitted request identity and ordered
selections; omitted reply policy stays omitted. Nine focused send tests failed
before implementation and now pass. Composer draft integration remains in U2.
Root `pnpm check`: 34/34 passed (31 cached), including ui-theia 1227/1227.

## U2a single-agent skill selection

`SkillSelectionControl` adds a mode selector (`auto`, `manual`, `off`) and
source-qualified exact-version checkboxes to the single-agent run composer.
Same-name workspace and global skills stay distinct with scope, path and
revision labels; stale selections remain visible so the user can remove them
without silent replacement. Initial receipts retain the selected policy and
captured session across uncertain retries, and non-default/selected sends route
through `threadSkillsStart` while plain default sends keep the existing route.
English and Turkish strings are synchronized, and the mechanical UI detector
reported `[]`. Focused control, composer and i18n suites pass (43/43).
Root `pnpm check`: 34/34 tasks, ui-theia 1232/1232.

## Explicit activation integration correction (2026-11-10)

Before exposing selection controls, source tracing found that preflight stored
explicit selections but neither driver invoked their loader before model work.
Earlier request tests loaded manually after the first request, hiding that gap.
The regression now requires selected instructions in the first request and
removes the manual test load. Both the sequential path and parallel-worker launch
load the ordered explicit prefix before compaction/request budgeting, retain a
new attempt's context identity before receipts, and return to the dispatch guard
after loading. Refused loads pause the already accepted run; cancellation drops
late results. The 48 focused cases pass. Core passed 750/750. The first root
check ended 33/34 after two CLI tests hit their existing 20-second deadline;
their two files passed 7/7 alone. The unchanged root rerun passed 34/34
(33 cached; CLI 317/317 executed). Failed output is retained at
`docs/reviews/logs/2026-11-10-explicit-activation-check-failed.log`.

Codex reference: the user requested using `openai/codex` as implementation
reference. Re-read its Apache-2.0 LICENSE and bounded skill discovery at the
existing fixed revision `e0aa0434f415b0c5bc0fb64abd7f03c5510f9ed6` (see the
[reference refresh](../../reviews/2026-11-08-reference-source-refresh.md)).
Its complete-inventory versus uncertain metadata distinction remains useful;
this CLI routing change copies no upstream code or text.

Development evidence: [Skill Activation Development](../../reviews/2026-11-08-skill-activation.md).

November 9 integration decision: explicit-set aggregate validation before run
creation is not expressible through the four approved runtime methods. The lead
requested approval for a separate receipt-free `skill.selection@1.check`.
The user approved it on November 9; ADR-191 records the exact read-only boundary.
Implementation resumed with native Sol owners for security and protocol work,
while main integrates the new contract, durable core state and run-read shapes.
Tests remain deferred, not passed or waived, because S2 implementation is unfinished.
