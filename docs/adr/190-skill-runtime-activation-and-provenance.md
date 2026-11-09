# ADR-190: Skill Activation With Durable Version Provenance

Status: Accepted
Date: 2026-11-08

## Context

ADR-189 deliberately delivered local discovery and exact-version management
without agent activation. Ordinary tool results can be cut or summarized, and
conversation replies inherit history. Neither mechanism authenticates loaded
instructions or defines what happens after the user disables their grant.

The user approved the S2 scope and pause-before-disable/revoked-resume refusal
with "evet devam et", then requested the next work after receiving the written
specification. This accepts the concrete interfaces, defaults and compatibility
rules in [Version-Bound Skill Activation](../superpowers/specs/2026-11-08-skill-activation-design.md).
Implementation and end-only validation follow the linked package-sized plan.

## Decision

- Keep S1 management and existing public shapes unchanged. Genuine legacy runs
  retain their behavior; missing markers alone cannot downgrade receipt-bearing
  runs. S2 uses explicit versioned entry ports and a persisted runtime marker.
- Expose eligible masked descriptors; use explicit selection or the ordinary
  task model's load request, without a classifier or blanket body injection.
- Add security-owned `skill.runtime@1`, native core-owned `skill.load@1`,
  `conversation.thread@3`, `run.skills@1` and daemon protocol 36 routes.
  Essential security provides source-independent receipt inventory without new
  required dependencies or startup discovery; optional skill execution resolves
  existing native source/catalog/trust ports through the registry.
- Bind immutable masked snapshots to workspace, run, task/attempt context,
  exact source bytes and grant revision through global content-bound receipts.
  A copied snapshot or caller-supplied digest cannot authenticate content.
  Inventory completeness is checked independently; every issued receipt of an
  unfinished run remains a dependency, including earlier task attempts.
- Persist before exposing instructions. Keep bodies outside ordinary message
  history, count them in context budgets and reconstruct them without rereading
  a different disk version after compaction or restart.
- Preserve system/current-user precedence, taint and every action policy.
  A skill grants no tool, permission, installation or script execution.
- Keep S1 idle mutation admission. Revocation or invalid current source evidence
  prevents subsequent model/tool work and automatic recovery; preserve history.
  A new grant revision never silently renews an old context's authority.
  Composition must attest the exact native engine/quiesce pair before S2.
- Isolate ordinary task attempts. Review/clarification/judge/summary/lesson
  contexts do not inherit task skills. No template rewrite or new dependency.
- Show selected/loaded/blocked/history states from authoritative reads, with one
  content-free refresh event. Loaded is not proof of remote model compliance.

## Consequences And Alternatives

Fresh source/revision checks cost local reads but avoid stale authorization.
Complete budgets can refuse a skill that S1 can approve; that is visible, never
silent truncation. An invalidated context requires a fresh run/selection instead
of an in-place trust override. Existing history is not rewritten.

Checks occur at core dispatch boundaries. Gateway-internal quota waits/retries
have no new authorization callback; external source changes during an in-flight
call are detected at the next core boundary. Supported grant mutation still
requires native pause/drain before acknowledgement. A receipt-only crash with
no durable masked payload is an explicit integrity failure, not a reconstruction.

Explicit-only staging is smaller but delays the approved description-based
workflow. Reusing editor attachments or ordinary tool text loses authority and
retention semantics. Storing only a self-declared content hash cannot authenticate
it. No external framework or generic prompt-plugin system is introduced.

This accepts only the S2 behavior left open by ADR-189 and narrowly extends the
context rules of ADR-126/169/170 for S2 entries. It does not reopen ADR-072's
writable-skill rule or any permission, verification, release or Phase 6 boundary.
