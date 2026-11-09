# ADR-188: MCP Workspace Knowledge Search

Status: Accepted
Date: 2026-11-08

## Context

The user approved the bounded M1 delivery in
`docs/superpowers/plans/2026-11-08-competitor-gap-next-slices.md` with "devam et".
The MCP server advertises `mete_knowledge_search`, but it always returns a
Phase 4 placeholder even though `knowledge.search@1` is available. The approved
scope is the existing workspace search, not personal memory or a new index.

## Decision

- Keep the tool name and its `{ query: string }` input. Whitespace-only input
  is invalid. No caller-selected scope, path, provider or run identity is added.
- Resolve `knowledge.search@1` on every call through the registry. Pass
  `scope: workspace` and the existing search schema's default result limit,
  without a fabricated run id or worktree. Preserve `team.engine@3` activation
  and the other three MCP tools.
- Return the existing search-result shape `{ results: KnowledgeHit[] }`,
  validated with the existing contracts schema, as structured content and the
  matching JSON text. A non-workspace hit or malformed result is an error,
  not a silently filtered or empty success. No capability schema, capability
  version or daemon protocol changes.
- Preserve adapter refusal codes as MCP tool errors (`isError: true`).
  An unavailable search or masking capability returns `not_supported`.
  Invalid adapter output or a thrown operation returns a generic `io` error
  without raw exception data. Only a successful search may return empty results.
- Require `secrets.mask@1` before returning adapter-controlled text, including
  failure messages. Validate the masked result before returning it; masking
  failures fail closed. Do not log queries, note content or unmasked failures.
- Forward the SDK request cancellation signal and refuse a result after
  cancellation or shutdown. The bridge adds no retries or background work.
  Cancellation is cooperative; already-started index or embedding effects are
  governed by the existing search module, not undone or falsely called absent.
- Retain knowledge privacy and `.meteignore` enforcement in the existing
  adapter. Search may refresh its index, record access and schedule/use gateway
  embeddings under ADR-152/173. It is not a zero-network operation by definition;
  tests use scripted adapters or an explicitly offline composition.
- No new dependency, permissions bypass, configuration write, real-provider
  test, personal-vault access, engine run or UI feature is part of this delivery.

## Verification

Write focused MCP cases before implementation, then execute them only after the
bounded implementation and source review. Cover dynamic registry resolution,
matching text/structured results, malformed output, refusal/masking, missing
services, cancellation and shutdown. A separate CLI-composition test exercises
real workspace notes, private/ignored notes and no-hit results with offline
providers. Preserve the conformance script's refusal-only calls using an
invalid search query instead of expecting the removed placeholder.

## Consequences

MCP clients can use the existing knowledge service without importing its module.
The advertised tool's success path becomes real; unavailable services remain
explicit. This partly supersedes ADR-149's deferred MCP-tool connection only.
It does not establish real-client, packaged-app, Linux or release acceptance.
