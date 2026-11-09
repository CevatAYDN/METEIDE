# ADR-193: Resolve editor sources by native opaque identity

Status: Accepted as an implementation boundary of the user-approved ADR-192 flow
Date: 2026-11-09

## Context

S1 masks `source.path` for display while preserving `sourceId`. A masked label
can remain syntactically valid and can name a different sibling file. It is
therefore not a filesystem address. Native editor opening in ADR-192 must
resolve the original opaque source identity instead of trusting the display path.

## Decision

- Protocol 37 adds the read-only, user-directed `mete/skills.editor` request:
  `{ sessionId, sourceId }`. Success is
  `{ ok: true, value: { sessionId, source } }`, where `source` is the original
  unmasked relative `SkillSourceDescriptor`. Failures use the existing typed
  `SkillError`. No body, root, arbitrary URI, grant or mutation receipt is returned.
- Resolve through the exact native `skill.source@1` implementation attested by
  the composition root. Capture descriptor/implementation identity, validate
  the entire source-read result and recheck identity/cancellation after awaits.
  The returned source id must equal the requested one.
- Reject a wrong daemon session before reading. The desktop retains and
  rechecks the exact transport/session/source binding; it never falls back to
  the masked display label or an older process.
- The raw relative name is used only for the explicit local editor operation.
  Normal list/review displays remain masked. Do not copy the editor address into
  model context, events, logs or ordinary inventory responses.
- Use the already-authoritative workspace/global roots to build the local URI,
  retaining link/kind checks. Register the target watch before opening the editor.
  Context retirement and failed opening clean up that watch.
- This changes no capability contract, source root, approval policy or model
  tool catalog. `skill.source@1` already returns the original descriptor.
  It adds no installation, inference, source write or automatic approval.
- Protocol 36's S2 declarations remain present; this addition does not complete
  their runtime handlers. Every pre-existing request/result retains its shape.

## Consequences

Implementation is split into contracts, CLI native resolution, and UI
transport/editor integration, each separately bounded. Only contracts gains a
public schema; the composition and desktop changes are internal wiring.
Regression coverage must include valid-but-masked sibling names, replaced native
adapters, stale sessions, cancellation and missing optional source support.
This is not an OS-level guarantee against concurrent filesystem replacement.

## Alternatives Rejected

- Treating a syntactically valid masked name as the original path.
- Comparing file content hashes alone: different sources may contain equal bytes.
- Changing S1 list/preview shapes to expose raw paths for every read.
- Returning an arbitrary filesystem URI supplied by a caller or unknown adapter.
