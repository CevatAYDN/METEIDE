# Verification Gates Implementation

Date: 2026-11-08, Europe/Istanbul.
Status: approved ADR-187 G batch verified on the Windows source build.
Implementation/source review preceded all tests/builds/IDE launches. Final
check 34/34, production bundle and combined Electron 1/1 passed; evidence and
the failed final-stage attempts are recorded in
`docs/reviews/2026-11-08-verification-evidence.md`.
Baseline: `c5d02494f65abd3709ecd8c559b8fb5dfde43d4b` plus the current working tree.
This plan does not itself establish runtime completion or change user data.

## Approved Result

A required check that cannot run prevents task submission. Only an explicitly
optional check may proceed with a visible not-run outcome. No model report or
missing historical event proves that a check passed.

The user approved this result; it is not being put back to a vote. AGENTS.md
requires the missing compatibility decision to be resolved before changing
behavior across contracts, core and consumers.

## Baseline Source Evidence

| Surface | Observation | Consequence |
| --- | --- | --- |
| `contracts/src/domain/template.ts:VerifySchema` | Capability gates allow args/expect; command gates allow run. Both reject unknown keys. | Adding optionality changes a public schema; it is not an untyped flag to append silently. |
| `contracts/src/domain/template.ts:BaseSchema` | The only accepted apiVersion is mete/v1. | File-format compatibility must be explicit, not inferred from metadata.version. |
| `core/src/domain/team-schema.ts:TeamStateSchema` | Persisted snapshots contain the validated full template. | Changing the parser can reject old saved runs or silently alter their resumed behavior. |
| `core/src/application/verify.ts:one` | Missing capability warns and emits no verify.completed; the loop may return passed. | The missing-check outcome needs actual durable evidence, not a UI guess. |
| `core/src/application/team-driver.ts:verified` | Passed proceeds to guardrail/submission; missing shell blocks. | Capability and shell absence currently have different progression behavior. |
| `contracts/src/domain/events.ts` and docs/07 | verify.completed has gate/ok/details only. | Keep old events readable; add a schema/catalog entry for new evidence rather than reinterpret old booleans. |
| `contracts/src/domain/task-control.ts:TaskPendingSchema` | Blocked waits carry an exact request identity and a string reason. | Reuse existing authoritative task controls where possible; no new human override is implied. |
| `core/src/application/steps.ts:runCapability` | Dispatch publishes tool-called/completed, without itself owning a persisted verification cursor. | Interruption/recovery needs a separately reviewed core slice, not an assumption that a helper call is durably complete. |
| `core/test/application/capability-gates.test.ts` | A regression explicitly expects a missing capability to be skipped and the run to complete. | Preserve it as a legacy-path assertion; add strict-path assertions instead of silently weakening it. |

These are source observations. No tests or IDE sessions ran in this planning
continuation, and no new PASS claim follows from the earlier U3-U5 results.

## Approved Compatibility

Recommended: **all newly started runs use strict verification, even when their
template file predates this change; saved legacy runs keep their original
semantics.** Old template files remain untouched. Unmarked checks in a new run
are required; optionality must be represented explicitly by the approved,
versioned format. Do not infer optionality merely because an adapter is absent.

Alternative: require explicit template migration before strict verification
applies. New runs of an unmodified old template remain legacy. Such a run cannot
be presented as fully verified simply because its state is completed.

The user approved the recommended all-new-runs boundary on November 8.
Neither option authorizes automatic writes to `.mete/teams/`, replaying uncertain
side effects, changing real accounts, or bypassing release checks.

## Bounded Slices

Every row is one package and one concern, about 300 manual changed lines at most.
Split again before that bound; do not combine contract evolution with runtime
or UI changes under one task.

| ID | Owner / package | Work | Prerequisite | End-stage evidence |
| --- | --- | --- | --- | --- |
| G-D1 | lead / docs | Record the chosen compatibility boundary and exact versioning ADR, including old-port behavior | User decision above | Old/new examples have unambiguous semantics |
| G-C1 | lead / contracts | Versioned gate definitions with explicit optionality; retain legacy parser/fixtures | G-D1 | Old/new valid, invalid and unknown-field fixtures |
| G-C2 | lead / contracts | Versioned outcome/event identity for task, attempt, evaluation and gate position | G-D1 | Passed/failed/not-run reasons cannot be confused; duplicate names remain distinct |
| G-E1 | Sol / core | Preserve legacy snapshots and initialize strict verification only at the approved boundary | G-C1 | Old saved runs parse; new runs choose the correct rules |
| G-E2 | Sol / core | Execute required/optional checks through existing policy/capability paths; unsupported expect cannot pass silently | G-E1, G-C2 | Missing adapter, policy wait/refusal, invalid output and unsupported expect |
| G-E3 | Sol / core | Durable verification cursor/outcomes and uncertain-operation recovery | G-E2 | Crash before/after dispatch, cancellation, pause/resume; no uncertain write replay |
| G-E4 | Sol / core | Keep each task attempt/evaluation independent through revision and best-of-N | G-E3 | Failed/missing checks cannot become selectable approved attempts; prior results are not reused |
| G-K | Sol / testing | Contract kits for changed/new capability versions; retain legacy kits | G-C1/C2 | Each registered version satisfies its own contract |
| G-A | Sol / cli | Adopt the approved version at composition/daemon boundaries and render real check evidence | Runtime ports finalized | No silent fallback to a permissive start path; compatible legacy reads |
| G-F | Sol / ui-studio | Fold new evidence without inventing results for old/broken events, only if a shared fold is needed | G-C2 | Replay/live deduplication and attempt/evaluation identity |
| G-U1 | Sol / ui-theia | Show required/optional and passed/failed/not-run with actual evidence | G-E4, G-F | Current task evidence, error/loading/legacy states, no model self-certification |
| G-U2 | Sol / ui-theia | Expose explicit optionality/version migration through existing authoring paths only as approved | G-C1, G-D1 | No automatic downgrade or protected-file write |
| G-T | lead / templates | Deliberately migrate built-in templates against docs/08; never infer optionality from environment | G-D1, G-C1 | Native browser prototype does not silently acquire a required external game engine |
| G-Q | lead / desktop | One combined required-block/optional-gap/persistence scenario | All implementation slices | Visible behavior with scripted models; no real provider calls |

Exact field names and capability versions belong in G-D1 before public API edits.
Do not introduce a new engine or read endpoint merely to attach a version number
if the selected contract boundary can use the repo's established mechanism.
No new dependency is proposed.

## Active Ownership

| Slice | Owner | Status | Scope |
| --- | --- | --- | --- |
| G-D1 | lead | approved | ADR-187; policy and compatibility fixed |
| G-C1/C2 | lead | verified | 277 contracts tests; V1/V2, durable schemas/events and protocol34 |
| Risk review | Astra / Beauvoir | source review complete | Recovery, execution ownership, attempt and admission risks sent to core worker; no runtime evidence |
| G-E1 to G-E4 | Sol / Dirac + lead runtime fixes | verified | 666 core tests; output validation, ownership, restart, attempts, admission and read-failure fencing |
| G-A | Sol / Lagrange + lead | verified | 220 CLI tests; @3 and authoritative evidence, complete history JSON |
| G-U1/U2 | Sol / Volta + lead | verified on Windows source build | 951 UI tests; indexed edits, lifecycle/disposal guards and current evidence summaries |
| G-K | lead | verified | New @3 engine and task.verification kits exercised by core; legacy kit retained |
| G-T | lead | verified | Only game-studio migrated to v2; explicit optional external-engine checks, CLI acceptance passed |
| G-Q | lead | verified on Windows source build | Combined Electron 1/1, restart identity, three themes/two sizes, six captures, axe |
| Independent review | Astra / Heisenberg | reported source findings closed | Runtime evidence owned by lead; reviewers did not execute tests |
| EN/TR integration | lead | verified by resource/UI tests | Current/legacy/uncertain/zero-gate text; interactive Turkish acceptance remains open |

No automatic hook state is assumed. The lead owns shared docs/resources and
serialized test/build/desktop resources. All workers are closed after handoff.
No worker started application tests or the IDE; narrowly scoped lint was allowed
only after the lead entered final validation.

The UI review found four concrete corrections before runtime validation:
text-keyed command removal can remove both required and optional duplicates;
attempt/lifecycle changes can leave current evidence stale; unknown metadata can
look like a team; closed task disclosures hide current verification gaps.
Copy separately distinguishes interrupted outcomes from known nonexecution and
does not infer that every legacy run lacked required checks. These are source
findings, not observed runtime failures or closed acceptance results.

## Test Sequencing

During implementation, write/update regression cases before matching production
changes but do not execute tests, bundle, or launch the IDE. Source review runs
in parallel with disjoint implementation work; runtime evidence is not inferred.

After all approved slices are integrated, run focused regression/contract checks,
`pnpm check`, then one batched Electron workflow. Necessary failure diagnosis
stays in that final stage; do not repeat broad suites between slices. A separate
release check, installer and public update acceptance remain required before
publication and are not implied by this feature batch.
