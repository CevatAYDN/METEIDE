# ADR-189: Version-Approved Skill Foundation

Status: Accepted
Date: 2026-11-08

## Context

ADR-031 and docs/10 specify SKILL.md support, but current runtime discovery and
activation are absent. ADR-072 deliberately keeps `.mete/skills/` writable by
agents. Merely finding a file there cannot authorize its instructions.

The user explicitly approved content-version authorization followed by
description-based or explicit selection. The concrete S1 design is
[Version-Approved Skill Runtime](../superpowers/specs/2026-11-08-skill-runtime-design.md).
The user approved this technical design and package sequence with "evet uygula".

## Decision

- S1 provides discovery, strict metadata parsing, complete masked previews and
  explicit approval/disable of exact versions. Agent activation is separate S2.
- Use only the specified workspace/global roots. A native source port confines
  reads without broadening the existing filesystem tools.
- Bind grants to canonical workspace/source identity and exact file bytes.
  Keep grants and decision audit in module-owned global SQLite tables, never
  repository-provided approval YAML or a caller-declared trusted hash.
- Prepare without quiescing; approve/disable after idle admission in the same
  daemon that holds the preview. Recheck source/masking/revision and update
  storage/audit atomically. After admitted mutations, retire that exact daemon
  on success or failure; never close its replacement or replay an uncertain
  approval. Quiesce requires retirement, not an invented unlock operation.
- Separate optional source/catalog/trust modules. Use kernel capabilities,
  existing YAML/Zod/SQLite dependencies and no new runtime dependency.
- Add `skill.source@1`, `skill.catalog@1`, `skill.trust@1` and daemon protocol 35
  management routes as separately reviewed package slices. Add no model tool,
  event, provider call, install path or permission grant in S1.
- Keep approved, changed, invalid, unavailable and actually loaded distinct.
  S1 cannot advertise active skill use; S2 must prove durable context semantics.

## Consequences And Alternatives

Version review adds explicit user work but prevents agent-authored changes from
automatically becoming authorized instructions. Global skills still require a
per-workspace grant in S1. Native path checks do not constitute an OS sandbox.

Rejected: trusting an entire writable folder, enabling all
metadata before review, silently repairing YAML, executing discovery hooks,
using editor attachments as skill authority, or importing another module.

This implements ADR-031's management foundation without changing ADR-072's
writable-skill rule. S2 context/events/contracts remain a separate future
decision, not an implicit grant.
