# ADR-187: Required Verification And Durable Evidence

Status: Accepted
Date: 2026-11-08

## Context

The user approved required checks blocking submission, explicit optional
not-run outcomes, and the recommended compatibility boundary: all newly started
runs are strict, including runs from old template files; saved runs retain
legacy semantics. No user template is rewritten automatically.

## Decision

- Publish the native engine as `team.engine@3`, with the existing method shapes.
  Update first-party consumers and contract kits; do not silently fall back to
  the permissive @2 start path. Keep the old exported input/output shapes and
  saved-run readers. The native module no longer registers @2.
- Preserve `TeamTemplateV1Schema` exactly. `mete/v2` adds `optional?: boolean`
  to command and capability gates; absent/false means required. The runtime
  template parser accepts both versions. All gates in a newly started v1
  template are required. The built-in browser-game template may explicitly
  mark its documented external-engine checks optional after migration to v2.
- Every newly created team stores `verificationVersion: 1`. An absent marker
  means the saved legacy behavior; never add the marker while loading a row.
  Spawned tasks use their enclosing run's mode. A source file's format is not
  used to infer the mode of an existing run.
- Add `task.verification@1.read({runId})`, returning mode and per-task current
  attempt identity plus the latest evaluation of each recorded attempt.
  Each evaluation identifies its attempt, attempt number, evaluation UUID and
  start time; ordered gate rows identify index, masked gate, optionality and
  state. The states are running, passed, failed and not_run.
- Not-run reasons distinguish not_reached, capability_missing,
  approval_required, denied, unsupported_expect and interrupted.
  An adapter execution error or invalid output is failed, never not_run.
  The existing undefined `expect` language is not guessed: any present expect
  produces unsupported_expect before invocation in strict mode.
- Required not-run prevents submission. Explicit optionality permits progression
  only past capability_missing, denied or unsupported_expect outcomes.
  not_reached identifies downstream work, not permission to skip it.
  A check that actually failed still requires repair. Policy asks
  still wait for exact approval, and user pause/cancel and interrupted operations
  never become optionality shortcuts.
- Persist an evaluation before dispatch and each running/final gate state.
  Replace only the matching evaluation/attempt, using current team state rather
  than an old captured copy. Keep the last evaluation per attempt in the task
  snapshot, so a later revision does not reuse an earlier pass. Preserve the
  historical outcomes through new `verify.evaluated` events.
- `verify.updated` is a wakeup for authoritative reads; `verify.evaluated`
  records final gate evidence with evaluation/attempt/index identity.
  Keep old `verify.completed` unchanged for legacy runs. Missing/broken old
  events are not reconstructed as a known skip or pass.
- Recover a running gate as not_run/interrupted, keep the exact evidence and
  block the task for explicit human inspection before retry. Never automatically
  replay an uncertain operation. Existing task controls remain authoritative;
  no new approval bypass is added. A new internal blocked reason, verification,
  fits task.control@1's existing string reason.
- A known completed outcome remains evidence after pause/cancel, but cannot
  advance a task owned by a different execution token. A late outcome must not
  replace another evaluation. Terminal run status must not be reopened.
- Daemon protocol34 adds `mete/task.verification`. The UI reads persisted
  outcomes instead of inferring them from a truncated activity feed; it clearly
  separates strict/legacy, passed/failed/not-run/running, and pending/read errors.
  No new ui-studio public fold is required.
- No new runtime dependency, account action, automatic user configuration
  write, expect evaluator, real-model test or Phase 6 feature is introduced.

## Consequences

New work cannot silently pass missing required checks. Old saved work remains
readable and explicitly legacy. Engine consumers must use @3; absent support
is a visible failure rather than a downgrade. Evidence persists independently
of notifications, including across restart.

Implementation follows the bounded G slices. Tests are authored before changes,
but all execution and desktop launches stay in the final validation stage.
This ADR does not close release, signing, update-download or Linux acceptance.

Partly supersedes ADR-120's missing-capability skip/expect handling for new
runs and the native engine registration version. Its legacy behavior stands.
