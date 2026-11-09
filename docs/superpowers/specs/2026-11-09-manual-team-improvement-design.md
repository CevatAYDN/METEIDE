# Manual Team Improvement

Status: PROPOSED contract design. ADR-192 approves the product scope, not this
new backend contract. The first UI recovery delivery does not expose a fake
Improve team action.
Date: 2026-11-09.

## User Flow

1. Choose an ended team run and one local skill.
2. Select Improve team and inspect the source run, skill version and request
   estimate before starting a separate proposal run.
3. Read the proposed instruction-body difference beside its cited evidence and
   explicit gaps. A ready proposal is not evidence that quality improved.
4. Apply to the native editor only after checking that the source is unchanged
   and that the editor has no unsaved changes. This creates an undoable draft,
   not an automatic disk write.
5. Save through the normal editor, then review and approve the new exact version
   through the existing Skills controls. Never carry the previous grant forward.
6. Validate the revised instructions on a subsequent explicit task. Do not mark
   them better merely because proposal generation or version approval succeeded.

No model fine-tuning, automatic recurring retrospective, permission change,
team-template rewrite, background model call or automatic skill approval.

## Proposed Contract

Add a user-management capability `team.improvement@1`, never a model tool:

```ts
start({
  requestId,
  sourceRunId,
  source: { sourceId, sha256 }
}, signal): Promise<Result<{ runId }, ImprovementError>>

read({ runId }, signal): Promise<Result<ImprovementView, ImprovementError>>

cancel({ runId }, signal): Promise<Result<null, ImprovementError>>
```

Identifiers use existing UUID and source/hash contracts. Every external input
and output is a strict Zod boundary. An exact repeated start intent returns the
same retained run; different input under the same request id is refused.
Do not silently downgrade to a generic conversation or ordinary template start.

`ImprovementView` distinguishes queued, running, paused, ready, failed and
cancelled. Ready contains a validated proposal with source identity/version,
masked baseline, proposed body, evidence references, gaps and observed model
provenance. No fabricated score, training status or automatic approval field.
Use safe error codes for invalid input, stale source, missing evidence, unavailable
modules, budget/quota refusal, cancelled operation and persistence failure.

Protocol additions and their exact schemas must be approved together; do not
silently reuse an S1 management method or alter an existing run input.

## Execution And Evidence

- Create a real, separately owned run with ordinary quota, budget, cancellation
  and model-call accounting. Never use a synthetic run id or direct provider
  probe to evade those controls.
- The native implementation owns a fixed proposal-only workflow. An editable
  workspace template with the same name must not replace it.
- The proposal role has no model-callable tools. Evidence is prepared natively
  from the selected ended run and exact selected source, masked and labeled
  untrusted data. Skill content is analysis input, not activated instructions.
- Source runs may be completed, failed or cancelled. Record incomplete evidence,
  missing verification or missing skill-use provenance as gaps, not success.
  Do not attribute a failure to a skill without evidence that it was used.
- One proposal-generation operation is the default. It uses existing gateway
  selection/fallback rules, not a promise of one provider HTTP attempt. No
  automatic regeneration or repair loop; explicit retry is a new intent.
- Keep complete source text within the existing skill size bounds. Specify
  evidence bounds in the owning defaults file with a reference to the accepted
  design before coding. Refuse an oversized input instead of silently omitting
  failure evidence.
- The generated output may change the instruction body only. Preserve source
  metadata and folder identity; tool permissions are never inferred from text.
- Persist validated proposal evidence before showing Ready. Events and global
  logs carry ids/status only, not instruction bodies or raw run transcripts.
- A cancelled or superseded execution cannot publish a later successful result.

## Applying Safely

The native editor remains the user-owned write path. Apply must revalidate the
same workspace, canonical source identity, exact raw bytes and current clean
editor state. An earlier preview hash alone is not write authorization.
Retain the normal editor's conflict handling and undo history.

Never replace raw source with a masked preview. When masking changed the source
or a proposal cannot be safely reconciled with the raw body, automatic Apply is
unavailable; show the proposal and allow manual editing of the original file.
Never silently replace an already dirty editor buffer.

Global sources keep their visible Global scope. An edit changes that file but
does not approve its new version in any workspace. Normal S1/S2 source-change and
revocation behavior remains authoritative. Filesystem checks do not claim an
OS-level sandbox against concurrent replacement by another process.

## Delivery And Acceptance

Split implementation into package-sized slices:

1. Contracts and strict proposal artifact schemas with regression tests.
2. Core evidence preparation and fixed proposal-run admission, separately.
3. Core generation/persistence/cancellation and exact-intent recovery, separately.
4. CLI native composition and validated user-facing transport.
5. UI source selection/progress and evidence/diff review.
6. UI conditional editor application and explicit version-review continuation.

Each slice stays around 300 changed lines including tests and owns one package.
No new dependency or public contract outside this design is implied.
Independent source review precedes executable validation.

Acceptance requires fake-provider integration tests plus actual isolated
Electron interaction: cancellation, restart, duplicate clicks, invalid output,
source change, missing evidence, dirty buffers, masking, global sources and
permission preservation. Real quality improvement requires a separate measured
before/after exercise; deterministic fixtures prove mechanics only.

Current status: no implementation or provider call for this proposed feature.
The existing Learning controls configure task lessons, not this workflow.
