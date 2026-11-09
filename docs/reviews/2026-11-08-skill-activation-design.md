# Skill Activation Design Review

Date: 2026-11-08, Europe/Istanbul.
Status: VERIFIED WITH CAVEATS for corrected written design only.
Implementation, the D-R3 source correction and runtime acceptance remain OPEN.
Workspace: `C:\Users\wwwla\Documents\Github\METEIDE`.
Baseline: `c5d02494f65abd3709ecd8c559b8fb5dfde43d4b` plus the current dirty tree.
Main: Astra lead. Independent reviewer: native `lead_review`, Astra / Ramanujan,
agent `01a1bcbc-18a0-7842-91d0-66a30e62e8a4`.

The user approved S2 scope and revocation behavior with "evet devam et".
The [written design](../superpowers/specs/2026-11-08-skill-activation-design.md),
[proposed ADR-190](../adr/190-skill-runtime-activation-and-provenance.md) and
[package plan](../superpowers/plans/2026-11-08-skill-activation-implementation.md)
remain proposals until the written-spec review. No implementation is claimed.

## Findings

| ID | Priority | Source evidence | Consequence | Required resolution |
| --- | --- | --- | --- | --- |
| D-R1 | P1, S2 requirement | `packages/security/src/infrastructure/skill-trust-store.ts:13`; `application/skill-previews.ts:131` | S1 persists a raw-byte grant, not proof that a retained masked instruction payload is authentic. Editing both snapshot text and its self-declared hash would defeat a self-hash-only design. | Global security-owned receipt binds the complete masked payload digest, owner, source, grant revision and canonical workspace. |
| D-R2 | P1, S2 requirement | `packages/security/src/infrastructure/skill-trust-store.ts:108`; `packages/core/src/application/recovery.ts` | Disable followed by approval of identical bytes must not revive the old context. A pending tool or rearmed timer can dispatch without another model call. | Match the exact issuance revision and guard manual resume, recovery and pending dispatch, not model calls alone. |
| D-R3 | P1, existing source gap | `apps/cli/src/application/skill-admission.ts:27`; `packages/kernel/src/domain/capability-registry.ts:59`; `packages/core/src/module.ts` | The selected gate/engine are checked for continuity but not for native provenance. A replacement chosen before capture can return success without draining the native engine. | Composition attests the exact native engine/quiesce pair; implement P0-C and P0-T before S2. |
| D-R4 | P1, S2 race requirement | `packages/security/src/application/skill-approve.ts:52`; `packages/tools/src/infrastructure/skill-reader.ts:61`; `skill-source-lookup.ts:33` | A source observation before asynchronous masking does not prove eligibility at load/dispatch time. | Final native source/revision checks after preparation, captured execution ownership, and admission serialized against management. |

D-R3 is a static counterexample verified by main against current source,
not an exercised plugin exploit. No source correction has been applied yet.
D-R1, D-R2 and D-R4 are constraints on new S2 behavior, not invented claims
that S1 already implements or fails an agent runtime it never delivered.
Native filesystem checks do not claim atomicity against arbitrary external
topology/content changes or an operating-system sandbox.

## Current Design Response

- Separate management and runtime ports; retain exact native adapter identity.
- Authenticate full masked payloads in global receipts, not workspace hashes.
- Persist before instruction exposure; keep bodies outside lossy message history.
- Bind selection/loading to source, revision, run and task-attempt context.
- Preserve S1 pause-before-mutation and exact-daemon retirement.
- Fail closed on revocation/source changes and keep historical evidence intact.
- Keep loaded state distinct from provider delivery or model compliance.

These are proposed corrections to the design, not verified implementation.

## Concrete Draft Review

The independent review rejected the first written draft's completeness and
post-wait guarantees. Main verified the referenced gateway contract/source
and corrected the following issues. The independent recheck confirmed all four
corrections and found no further contradiction within that correction surface.

| ID | Priority | First-draft issue | Written correction |
| --- | --- | --- | --- |
| D-R5 | P1 | Removing a marker/owner/receipt could bypass checks over only supplied snapshots. | Essential security exposes complete source-independent run inventory. Receipt-bearing runs cannot downgrade to legacy; every issued receipt of an unfinished run remains a dependency. |
| D-R6 | P1 | The draft implied authorization checks after gateway-internal quota waits/retries, without a corresponding gateway interface. | Checks stop at the core dispatch boundary. Existing signal/native pause-drain governs supported grant mutation; external file changes during a gateway call are observed at the next core boundary. |
| D-R7 | P2 | Receipt-only crash recovery promised the same result although no retained full payload could reconstruct it. | Missing durable payload is integrity_failed and paused, never regenerated; exact retained loads preserve original metadata. |
| D-R8 | P2 | Authenticated selection origin had no issuance input. | Native core derives origin; security receives it through privately admitted native operation identity, never model arguments. |

The source-independent inventory uses essential security's existing storage
dependency, without requiring the optional source/catalog/trust modules or
scanning on startup. Execution consumes those native optional ports through
the registry. This is a proposed interface/ownership decision for written
approval, not a secretly accepted change to S1.

The observation-window limitation in D-R6 is deliberate. A guarantee before
every provider send would need a separate gateway contract change; S2 does not
claim that capability. The original source finding D-R3 remains unfixed in code.

The recheck also found a P2 regression-matrix phrase that could treat a missing
runtime port as an empty receipt inventory. Main replaced it with the exact
source-independent inventory requirement: absent optional sources are allowed;
absent/corrupt authority is never empty. This final wording correction was
inspected by main, not a new independent runtime test. The reviewer is closed.

## Evidence Boundary

Main and reviewer read the current source, relevant accepted documents and
bounded Git state. Existing source and tests remain untouched by this design pass.
The earlier S1 passing counts remain historical; this pass does not rerun them.

No Sol coding worker, runtime test, build, typecheck, IDE launch, provider call,
installation, account operation, commit, push or release ran for S2.
`pnpm check`: NOT RUN, preserving the user's end-of-development sequence.
Document checks are recorded separately and cannot establish runtime acceptance.
The first four-document link/LF/ASCII/trailing-whitespace check and tracked
`git diff --check` exited 0 before the review corrections. Final document
validation is recorded below after the revised files are checked.

Final document-only validation: Node checked the revised spec, plan, ADR, this
review and the S1 follow-up note; exit 0 with no missing local links, CR endings,
non-ASCII text or trailing whitespace. `git diff --check` also exited 0.
No production/test assertion was changed, and `pnpm check` remains NOT RUN.

Final proposed contract inputs, before this evidence-only report update:

| Document | SHA-256 |
| --- | --- |
| S2 spec | `5623ba69813dd8997624690aa107efa6caa1488010b848e02edccad14cd69708` |
| S2 plan | `7df103e56290d1085287b76373ebc7300e5ecca9744fe6b8f53d5ed621995c23` |
| ADR-190 proposal | `49c066bd7df46ea1b4ae3d77ac11cb4a168bb2adda5609702730e73b5c010bd2` |
