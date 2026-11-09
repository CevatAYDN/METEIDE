# Competitor gaps: next bounded slices

Date: 2026-11-08, Europe/Istanbul.
Status: M0/M1 completed in the user-approved continuation; source/offline checks passed.
Owner: main lead. Planned code owner: `lead_code` / GPT-6.1 Sol.
Independent security/contract reviewer: `lead_review` / GPT-6 Astra.
Chat: `01a1baff-fa38-7981-aeda-0c90edca0be0`.

Continuation: the user selected M1 for completion in chat
`01a1bb28-b67b-7962-96a6-df22b364a89c`. Final source/offline evidence is in
[the delivery report](../../reviews/2026-11-08-mcp-knowledge.md) and
[its continuation ledger](../../reviews/2026-11-08-continuation-readiness.md).
The original investigation and worker rows below are historical, not live
ownership. S/K decisions and platform/release acceptance remain open.

## Baseline and boundaries

- HEAD: `c5d02494f65abd3709ecd8c559b8fb5dfde43d4b`, branch `main`.
- The existing worktree contains extensive tracked and untracked changes,
  including ADR-186/187 implementation. HEAD alone does not identify this baseline.
  Preserve every existing edit. The initial investigation changed only this plan;
  the approved continuation is limited to the M delivery below.
- Current work remains Phase 5, as [ROADMAP](../../../ROADMAP.md) requires.
- The [earlier continuation plan](2026-11-08-reference-product-completion.md)
  remains historical/contextual evidence. This chat does not take ownership of
  another chat's workers, processes, approvals or operational state.
- No trusted lead hook brief/path was provided. This file and the in-chat ledger
  record this run only; automatic reminders and hook recovery are unverified.
- Source inspection is not runtime acceptance. Earlier passing counts and
  installed-app reports are not new passes. No tests, builds, IDE launches,
  installations, model calls, commits or publication ran in this investigation.

## Research method

Read current instructions, roadmap, architecture, module boundaries, relevant
ADRs and orchestration/tools/knowledge/UI/testing specifications before selecting
work. Re-read concrete implementation paths rather than adopting the old matrix's
absence labels. The [older matrix](../../reviews/2026-11-07-reference-feature-matrix.md)
and [refresh](../../reviews/2026-11-08-reference-source-refresh.md) are leads only.

The six primary sources below were opened during this investigation. Three are
fixed repository snapshots from the previous source ledger; the others are
official documentation retrieved today. This is a bounded comparison, not a
latest-release survey, executed upstream benchmark or complete feature inventory.
No upstream implementation or prose was copied.

| Reference | Observed behavior | METE implication, not an upstream claim |
| --- | --- | --- |
| [OpenAI skills][skills] | Metadata exposes name/description first; matching or explicit invocation loads full instructions. Skills and MCP authorization have separate responsibilities. | Implement discovery, selection and loading separately; a writable folder is not runtime support. |
| [CrewAI memory][memory] | The retrieved page resolves to v1.15.37 and describes shared/scoped recall and task-context insertion. Saving/inference can use a model. | Complete METE's specified scopes and retrieval without importing a Python engine, default provider, extra model calls or an automatic learning policy. |
| [ChatDev human node][human] | The documented node pauses for visible human input and passes the answer downstream. | Retain METE's existing exact task identities, bounded revisions and independent task progress; do not rebuild approvals merely for parity. |
| [TokenEconomizer][economizer] | The inspected README describes repeated-session evidence, reversible tool pruning and bounded failure-loop redirection. | Preserve ADR-166's deterministic nudge. Automatic consolidation/pruning is not authorized by this comparison; upstream savings are not METE measurements. |
| [Theia Open VSX][theia] | The version-matched extension supplies Open VSX integration. | Reuse METE's existing native Extensions surface; no second marketplace or editor fork. |
| [Cline MCP][cline] | Its setup flow ends with visible tools and an actual tool call, not configuration alone. | A listed METE MCP tool must route to a working capability or report a real, current limitation. |

## Current gap ledger

Priorities below are product-work priorities, not reproduced runtime incidents.
Absence findings are limited to the inspected runtime and composition surfaces.

| ID | Priority | Current source evidence | Missing outcome |
| --- | --- | --- | --- |
| M1 | P1 | [mete-tools.ts](../../../packages/mcp/src/application/mete-tools.ts#L160) unconditionally returns a Phase 4 error for `mete_knowledge_search`; [server-module.ts](../../../packages/mcp/src/server-module.ts#L28) already lists `knowledge.search@1` as optional. | External MCP callers cannot use the existing workspace search through this advertised tool. |
| S1 | P1 | [workspace.ts](../../../packages/core/src/application/workspace.ts#L38) and [instruction names](../../../packages/core/src/domain/workspace.ts#L15) read top-level instructions. Runtime searches across packages/apps found no SKILL.md discovery or selection path. | The skills described in docs/10 do not reach agent context through a dedicated runtime mechanism. |
| K1 | P1 | [search.ts](../../../packages/knowledge/src/application/search.ts#L163) refuses personal scope; [vault-tools.ts](../../../packages/knowledge/src/application/vault-tools.ts#L49) supplies the same fixed refusal to reads/writes. | No configured personal-vault access path in these callers; project-to-project knowledge remains incomplete. |
| K2 | P1 | [search module](../../../packages/knowledge/src/search-module.ts#L17) registers note search with optional embeddings; package exports/composition expose no native code-graph implementation. | Structural code indexing/query and freshness evidence are missing from the specified Phase 5 knowledge scope. |
| K3 | P2 | [search.ts](../../../packages/knowledge/src/application/search.ts#L145) combines keyword/vector hits only; runtime search found no backlink or routed rerank path. | Backlink expansion, important-query reranking and complete source provenance remain incomplete. |
| U6 | P2, unconfirmed | Earlier review records sidebar clipping; this investigation did not launch the desktop or reproduce it. | Reproduce at final UI validation before scheduling a fix; do not invent a defect from an old screenshot. |

Do not reschedule these as absent:

- ADR-187 strict verification has a concrete
  [implementation](../../../packages/core/src/application/strict-verification.ts).
  `not_run`, failure, approval and interruption are distinct. Its latest tests
  were not rerun here.
- Conversation model evidence exists in
  [chat-board.tsx](../../../packages/ui-theia/src/application/chat-board.tsx).
- Settings searches hints/action labels in
  [settings-groups.ts](../../../packages/ui-theia/src/application/settings-groups.ts).
- Initial-empty and no-search-match states are separate in
  [thread-list-view.tsx](../../../packages/ui-theia/src/application/thread-list-view.tsx).
- Persistent threads, explicit editor context and guided MCP credentials have
  accepted ADRs 182-184 and implementation. Broader product/platform acceptance
  remains separate from that source observation.

## Approaches

1. Recommended: close M1's small existing-capability connection first, then S1,
   personal vault, structural graph and richer retrieval in dependency order.
   This delivers a usable result without waiting for a large new subsystem.
2. Skills first: directly improves agent context, but needs trust, matching,
   source identity and public-interface decisions before code can safely start.
3. Release-only first: useful for distribution, but does not close these runtime
   gaps. Security migration, signing and publication remain separately scoped.

Phase 6 triggers, external engine adapters, replay, learning router, automatic
memory consolidation and tab completion remain excluded. Graph visualization
also stays Phase 6; structural graph work is already in Phase 5 under ADR-144.

## Proposed first delivery: M1

The existing MCP tool keeps its name and `{ query }` input. It resolves
`knowledge.search@1` through the registry for each request and searches workspace
notes only. Do not import `@mete/knowledge`, add another index or allow callers
to select a personal vault, filesystem root, provider or run identity.

Proposed acceptance:

1. A registered scripted search adapter returns validated search results to an
   in-memory MCP client; a second query reaches the adapter with its own input.
2. A missing/deactivated adapter returns an honest capability-unavailable error,
   not a fabricated empty success or obsolete phase message.
3. Empty/invalid input and malformed adapter output fail at the Zod boundary.
4. Request cancellation and shutdown do not become successful results.
5. Existing privacy/ignore decisions and refusal results are preserved.
   Outbound text and errors obey the existing secret-masking rules.
6. No team run starts, no configuration changes and no real provider is called
   by tests. Existing three team tools and `team.engine@3` activation are retained.

First resolve M0: document the exact MCP success/error mapping, masking,
cancellation and existing search-side-effect behavior (index/embedding jobs).
Do not market a search as zero-network merely because the bridge is read-only.
If a public schema must change, stop for a separate approved, versioned contract
slice; do not hide that change inside M1.

## Ownership and dependencies

Every implementation row is one package and one concern, about 300 changed
lines maximum including regression coverage. Split before exceeding the limit.
Exact new filenames for later work are fixed only after its design is approved.
The lead exclusively owns shared specifications, ADRs, Changesets and integration.

| Task | Owner | Files/area owned | Depends on | Done/verification | Status |
| --- | --- | --- | --- | --- | --- |
| R0 bounded comparison | Main lead | This plan; read-only source research | None | Primary-source facts and current local pointers, no runtime claim | verified for source inspection only |
| M0 bridge decision | Main lead | ADR-188, docs/10, Changeset, conformance expectation | Plan approval | Exact result, failure, cancellation and masking rules recorded in ADR-188 | implemented |
| M1 bridge implementation | Sol / Darwin | `packages/mcp/src/application/mete-tools.ts`, `src/server-module.ts`, focused helper/tests under `packages/mcp/` | M0 | 298 changed lines reported; 22 new cases authored, not executed; review pending | implemented |
| M1-C composition coverage | Sol / Noether | New `apps/cli/test/mcp-knowledge.test.ts` only | M0; final execution after M1 | Four authored cases, including post-index privacy/deletion; not executed yet; worker closed | implemented |
| M1-H boundary correction | Sol / Darwin | MCP helper and focused MCP test only | Initial M2 findings | Per-string masking and validated ToolError variants; separate bounded correction | running |
| M1-P native-mask regression | Sol / Noether | CLI composition test only | Initial M2 finding | Generated CRLF PEM is actually present before masking and absent from the returned payload | running |
| M2 independent review | Astra / Turing | Read-only M1 diff and raw final evidence | M1 | Initial P1 masking/P2 refusal findings in review ledger; revised review pending | running |
| S-D skill design | Main lead | New skill spec; proposed ADR; relevant docs | Plan approval; implementation after M delivery | Trust, scopes, collision order, matching, source changes, limits and disable behavior decided | pending |
| S-C skill contracts | Sol | `packages/contracts` only | Accepted S-D | Zod fixtures and version boundary; no implicit privilege grant | pending |
| S-L discovery/loading | Sol | One selected adapter package only, fixed by S-D | S-C | Bounded scan, paths, malformed/ignored/changed files; no script execution on discovery | pending |
| S-E context integration | Sol | `packages/core` only | S-L | Selective loading and durable provenance; resume/compaction/cancellation regressions | pending |
| S-T transport | Sol | `apps/cli` only | Approved protocol schema, S-E | Validated read/control requests; no silently dropped selections | pending |
| S-U visibility | Sol | `packages/ui-theia` only | S-T | Source and used/not-used state; user controls and EN/TR coverage | pending |
| K-D personal-vault design | Main lead | Proposed ADR and docs/11/13 | Skills delivery | Explicit folder choice, policy, privacy, indexing and cross-workspace boundaries | pending |
| K-P access/retrieval | Sol, successive slices | `packages/knowledge`; transport and UI separately | Accepted K-D | Private/malformed notes, canonical paths, refusal and workspace separation | pending |
| K-G structural graph | Sol, successive slices | `packages/knowledge`; contracts first where required | Approved graph API | Incremental parse/store/query, rename/delete/ignore/stale cases | pending |
| K-B backlinks | Sol | `packages/knowledge` | Approved search version | Source-specific ranks, cycles, missing/private/stale targets | pending |
| K-R rerank | Sol, successive slices | `packages/gateway`, then `packages/knowledge`, never together | Approved contract and K-G/K-B | Fake-provider tests, quota/timeouts and stable fallback; no unmeasured savings claim | pending |

At most three workers may be open, with disjoint writes. Research and design can
overlap bounded code work only after approval. No nested fan-out. Recheck dirty
hunks at dispatch, especially the existing ADR-187 MCP edits.

## Validation and approval boundary

Author regression tests before implementation. Preserve the existing plan's
end-of-development validation sequencing: execute checks after the approved
bounded delivery is implemented and source-reviewed, not while workers edit.
For M1, run the focused MCP suite and `pnpm check`; inspect raw output and actual
changed hunks. Add offline protocol/composition evidence where the new boundary
requires it, as separately sized coverage rather than widening a worker silently.

UI work later additionally needs real source-built Electron interaction,
keyboard/accessibility and narrow/wide viewport evidence. Windows source results
do not establish Linux, packaged installation, a real account flow or release.
No release gate, dependency age rule or signature check is weakened.

The user approved M1's precise design and bounded implementation with "devam et".
S/K remain the subsequent design queue, not blanket approval of unwritten ADRs,
dependencies, public APIs or publication. ADR-188 records the M0 decision.
At implementation start `pnpm check` is NOT RUN; final evidence will be added.

Planning checks: `git diff --check` exited 0 on the pre-existing tracked diff.
A separate Node check of this untracked plan found no missing local links,
out-of-range line anchors, CR endings, non-ASCII text or trailing whitespace.
These are document checks, not implementation or release acceptance.

[skills]: https://developers.openai.com/plugins/concepts/skills
[memory]: https://docs.crewai.com/v1.15.37/en/concepts/memory
[human]: https://raw.githubusercontent.com/OpenBMB/ChatDev/464a681ba7bda869db97a50c5fa707c9a0fb57a0/docs/user_guide/en/nodes/human.md
[economizer]: https://raw.githubusercontent.com/microsoft/TokenEconomizer/0aa2aca2423328863fe52a0beef0ed6323ff1e63/README.md
[theia]: https://raw.githubusercontent.com/eclipse-theia/theia/d8106d7ffa62b3413ff1ca5b63a0e6c2fe0b0649/packages/vsx-registry/README.md
[cline]: https://docs.cline.bot/mcp/mcp-overview
