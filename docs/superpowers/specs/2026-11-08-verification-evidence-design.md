# Verification Evidence Decision

Date: 2026-11-08.
Status: policy and recommended compatibility boundary approved by the user on
2026-11-08 ("onerilere uy ve devam et"). ADR-187 records implementation decisions.
Follows the approved U3-U5 batch in the reference product completion plan.
The implemented Windows source-build result and acceptance boundaries are in
`docs/reviews/2026-11-08-verification-evidence.md`.

## Baseline Behavior Before ADR-187

- `packages/contracts/src/domain/template.ts:VerifySchema` accepts a capability
  with optional `args` and arbitrary `expect`, or a shell command.
- `packages/core/src/application/verify.ts:capability` accepts an adapter's
  successful Result, returns skipped when no adapter exists, and does not
  evaluate `expect`. `one` warns for a skipped capability without emitting
  `verify.completed`; `verifyGates` can then return passed.
- `packages/core/src/application/team-driver.ts:verified` logs the skipped
  capability and lets passed continue to the guardrail/submission.
- `packages/core/test/application/capability-gates.test.ts` explicitly asserts
  this missing-capability behavior. These are source/test-assertion observations,
  not tests executed during this investigation.
- `verify.completed` currently has `gate`, `ok` and `details` in contracts and
  docs/07. Its boolean cannot distinguish not-run from a failed execution.
- Docs/08's precise gate paragraph permits this behavior under ADR-120.
  The later blanket claim that all capability gates are skipped was stale and
  is corrected separately, without changing runtime behavior.

## Approved Policy

The user approved that a required check which cannot run prevents submission:
**optional checks must be explicitly optional, and their
absence must remain visible as not run, never successful.**

This changes accepted behavior. It needs a new ADR, versioned contracts, event
schema/catalog work and a compatibility design before core implementation.
The policy itself must not be asked for again.

## Approved Compatibility Boundary

The existing `mete/v1` template schema has no optional-check field. The user
subsequently approved the recommended distinction between new runs and saved
runs, including newly started work from existing v1 templates.

Recommended boundary: every newly started run uses the strict rule; previously
persisted runs retain their recorded legacy semantics. Existing template files
are not rewritten automatically. Explicit optionality needs a versioned schema,
and built-in template changes must be reviewed against their documented purpose.
This boundary is approved; implementation and verification are tracked separately.

Alternative: only explicitly migrated templates use strict verification; a new
run from an old template remains legacy and must be visibly unverified where
evidence supports that label. This preserves more behavior but delays the safety
improvement for existing users.

Detailed package slices and source findings:
`docs/superpowers/plans/2026-11-08-verification-gates-implementation.md`.

## Alternatives

1. **Required checks block; explicit optional checks disclose the gap.**
   Strongest default for evidence-based completion, but templates and resumed
   legacy runs need deliberate compatibility rules.
2. **Keep legacy permissive progression and add visible not-run evidence only.**
   Least disruptive, but a required verification can still be bypassed by its
   environment. The UI must not describe such an outcome as fully verified.
3. **Automatically install a missing adapter or invent an expect evaluator.**
   Rejected: conflicts with user-controlled setup and guesses undocumented
   language/permission semantics.

## Policy Semantics

- Distinguish passed, failed and not run, with a reason for missing adapter,
  policy wait/refusal, unsupported condition or interruption. A paused or
  interrupted operation is not evidence that the checked work failed.
- A required not-run check prevents submission. An explicitly optional not-run
  check may allow progression, but its visible gap survives completion/restart.
- `expect` has no defined expression language today. Do not silently evaluate
  or ignore it under the new semantics: report unsupported until a separately
  documented evaluator exists.
- Bind each outcome to its actual task/attempt and gate position, so duplicate
  commands/capabilities do not collapse distinct checks or reuse prior-attempt
  evidence. Record only available command/capability output and masked details.
- Existing policy approvals and exact task identities remain authoritative.
  Changing the displayed result must not grant an operation or replay uncertain
  side effects.
- Keep current legacy schemas and stored run semantics readable. A legacy skip
  may be presented as a legacy unverified gap when there is actual evidence;
  no missing historical event may be reconstructed as a known skip or pass.
  Upgrading a template must be an explicit, reviewed migration, not an automatic
  write to `.mete/teams/`.
- No new human override or silent downgrade is introduced by this design.
  A user can configure the required adapter or deliberately revise a future
  template through existing user-controlled paths.

## Package Order

1. Docs: approve the behavior and compatibility ADR.
2. Contracts: version the needed outcomes/template surface and any new event;
   preserve old contract kits and update docs/07.
3. Core: persist and enforce outcomes within existing gate/task/attempt flow.
4. ui-studio only if its public fold must change, as its own slice.
5. ui-theia: distinguish executed pass/failure from not-run and expose evidence.

Each package/concern is split again before about 300 manual changed lines.
No new dependency, engine or Phase 6 capability is proposed.

## Final Acceptance

Write focused cases before code, execute them only at the end of the approved
development work: present/missing adapter; optional versus required; policy
wait; unsupported expect; duplicate gates; best-of-N attempts; cancelled or
recovered work; legacy data. A scripted model cannot self-award verification.
Then run the applicable contract checks, `pnpm check` and one batched desktop
workflow with visible not-run/pass/fail evidence. No real model calls in tests.
