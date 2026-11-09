# ADR-191: Receipt-Free Skill Selection Validation

Status: Accepted
Date: 2026-11-09

## Context

ADR-190 requires an invalid or oversized explicit skill selection to be refused
before a run is created. Its runtime catalog has no body sizes and may itself be
unavailable because of its independent metadata budget. Runtime loading issues
a receipt only after core commits a run. Those four methods cannot implement
the promised pre-admission aggregate check without creating unwanted state.

The user approved the proposed separate read-only `skill.selection@1.check`
with "evet gerekli her seyi deneyebilirsin" on November 9. This closes the
specific missing-contract decision; it does not waive existing permissions,
verification requirements, package-sized ownership or release approval.

## Decision

- Add `skill.selection@1` to essential security alongside `skill.runtime@1`,
  without altering the latter or any S1 capability.
- `check({ selected: SkillVersion[] }, signal)` returns
  `Result<null, SkillRuntimeError>`. The ordered selection is distinct by source
  and bounded by the existing per-context count. No owner, root, body, session,
  claimed byte count or trust declaration is accepted.
- Empty selections succeed without optional source/catalog/trust discovery.
  Nonempty selections require the same composition-attested native source,
  catalog, trust and captured masker evidence as runtime loading.
- Validate the complete source inventory and every exact current raw digest and
  enabled grant revision, mask the full inspections and count their actual UTF-8
  text bytes together. Do not truncate. Recheck cancellation, adapter identity,
  source/version and grant revision after asynchronous preparation.
- Successful checking returns neither contents nor reusable authority. It
  creates no run, receipt, S1 review preview, audit mutation, model request,
  configuration file or grant. It is not a model tool or daemon endpoint.
- Native core checks each explicit context/role set before run admission.
  An oversized model catalog does not prevent this separate validation; an
  incomplete native source inventory still does.
- The saved run's loader validates again. A later source or authority change
  may still pause that already admitted run under ADR-190. Preflight is not a
  reservation, a grant, an atomic cross-database commit or a permanent promise.
- Model-initiated additions still check the actual retained context count and
  bytes before issuing a new receipt. The private native admission callback
  receives the candidate masked text byte count, not a model-provided size,
  and refuses before commit when the retained context would exceed its budget.

## Consequences And Alternatives

This adds local reads but keeps rejected explicit sets out of run history and
keeps full bodies out of the model catalog. Existing limits and defaults remain.
The loader never treats a preflight result as authorization.

Extending `skill.runtime@1` in place would change its approved contract.
Using S1 review previews would mix management with execution. Creating a run
and only then checking the explicit aggregate would abandon ADR-190's admission
guarantee. None is needed for this narrowly scoped read-only capability.

This supplements ADR-190's runtime port inventory; its other decisions stand.
