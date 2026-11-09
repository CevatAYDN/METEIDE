# ADR-194: Skill Load Tool, Commit Order And Release Gate

Status: Accepted
Date: 2026-11-09

## Context

S2 core work (ADR-190/191) is implemented through E8, but three questions were
left open: how the model is offered the native loader, how ~500 uncommitted
files are recorded, and whether a release may be published now. On November 9
the user delegated these decisions ("karar bekleyen konulara sen karar ver").
The delegation does not waive AGENTS.md, ADR-179/185 or the docs/15 gates.

A clean worktree of `c5d02494` (before any S2 work) failed default-parallel
tests three of four times with `vi.waitFor` timeouts, so the instability is
pre-existing and not caused by S2.

## Decision

1. **`skill_load` model tool.** Offer `skill.load@1` as the model tool
   `skill_load` with input `SkillVersion` and output `SkillLoadOutput`. It is
   offered only to the seat that owns a skill context (the single agent or an
   ordinary team worker, ADR-190 seats) of an S2 run in `auto` mode whose
   context catalog is ready. Reviewers, answerers, judges, routers,
   summarizers, lesson writers and MCP clients never see it. Origin is `model`,
   derived by core. A requested version must be an entry of that seat's ready
   catalog; anything else is `bad_input` and reaches no security call. The tool
   is a context mutation, never a parallel query. The catalog itself is fetched
   once per context and retained, so its metadata stays stable for the context.
   First delivery offers the tool on the sequential driver path only (single
   agent and the active sequential team worker). Parallel scheduler workers use
   a separate prepared/checkpoint tool path; they still receive their pinned
   block but are not offered `skill_load` until that path routes it natively.
2. **Commit order.** Record the existing work as Conventional Commits split by
   package before more feature work, so each package's history is reviewable.
   Commits are local; nothing is pushed without a release decision below.
3. **Release gate.** No public release is published from this state. Phase 5's
   exit gate is not met, CLI/UI slices (T1–T3, U1–U3) are not done so S2 is not
   reachable in the desktop app, and `pnpm release:check` cannot pass reliably
   while the pre-existing timing failures remain. A release follows docs/15 in
   full (Changesets, `release:check`, checksums, `gh release`) only after:
   the timing failures are fixed without weakening tests, T/U slices land,
   and `release:check` passes. Update installation is then verified on that
   real release with Help → "Check for Updates…" from the previously installed
   build. No experimental ADR-185-style shortcut is taken.

## Consequences

The model can load approved skills only through the exact catalog it was shown,
under the same native admission, budget and receipt rules. Work stays local and
reviewable. The user's release request is deferred to a gate that can actually
be verified rather than published unverified.
