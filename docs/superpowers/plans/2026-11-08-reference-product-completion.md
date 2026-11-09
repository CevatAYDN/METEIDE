# Reference-based product completion

Date: 2026-11-08, Europe/Istanbul.
Status: U3-U5 and the ordered G/S/K design investigations approved by the user
on 2026-11-08 ("evet varsayim yapmadan devam et"). Unwritten G/S/K ADRs,
new dependencies and public APIs remain unapproved.
Baseline: `c5d02494f65abd3709ecd8c559b8fb5dfde43d4b` plus the current working tree.
This plan does not claim that METE is complete, superior to its references,
release-ready or past Phase 5.

## User Direction

Use the relevant skills and reference projects, establish evidence before
decisions, and improve the difficult daily workflows. The user's latest
instruction is binding: tests belong at the end of development, with no
repeated IDE launches during implementation.

The broad request crosses package and decision boundaries. AGENTS.md requires
package-sized slices and approval before implementation of this new scope.
Each slice below owns one concern and about 300 manual changed lines at most.
Split again before exceeding that limit; generated lockfile changes are reviewed
separately. No shared-public-API change is hidden inside a UI slice.

## Evidence And Existing Work

- Source reference matrix: `docs/reviews/2026-11-07-reference-feature-matrix.md`.
  It is historical evidence, not the current implementation inventory.
- Pinned-source refresh: `docs/reviews/2026-11-08-reference-source-refresh.md`.
  Upstream source behavior is distinct from measured METE behavior.
- Current work and checks: `docs/reviews/2026-11-08-lead-work.md`.
- Existing F1-F7, P1-P5 and C1-C5 work remains in the November 7 roadmap.
  ADR-184 also implements T1-T3 MCP management; do not schedule it as absent.
  Its native external-browser/account and platform acceptance remain separate.
- This pass has already repaired workspace recovery, Welcome continuation,
  compact Tools navigation and stale-workspace actions. Those are not new
  proposals below. The editor-input repair changes the test helper, not the
  user's editor behavior.
- Final release validation was interrupted at the user's request. The earlier
  completed run passed 10/13 gates; it predates the final helper/cache repairs.
  Security findings, actual public update download, signing and Linux remain open.

## Current Local Gaps

Source observations below were re-read on November 8. They are not new runtime
results. The prior dual-assessment UI critique is retained as a baseline only;
its 22/40 score must not be re-used as a score of the repaired interface.

| ID | Priority / type | Evidence | Bounded consequence |
| --- | --- | --- | --- |
| U3 | P2, visibility | `packages/ui-theia/src/application/chat-board.tsx`, `Header` / `Diagnostics` | Completed answer's model is in collapsed diagnostics, while the header shows conversation/status only. |
| U4 | P2, search enhancement | `packages/ui-theia/src/application/settings-groups.ts`, `searchGroups` | Only group labels and section names/titles match. Visible hints and linked action labels, including Theme and Editor extensions, are omitted. Existing behavior matches ADR-180's narrow search scope; expansion requires an explicit design decision. |
| U5 | P2, empty-state clarity | `packages/ui-theia/src/application/thread-list-view.tsx`, `Notices` | Every empty ready list says no conversations match the search, even with no query. This confuses an unused workspace with an unsuccessful search. |
| G1 | P1, verification semantics | `packages/core/src/application/verify.ts`, `capability` / `one` / `verifyGates`; docs/08 Verify gates | Missing capability gates are warned and skipped; overall verification can return passed, and `expect` is not evaluated. This is documented behavior, not permission to change it silently. |
| S1 | P1, missing runtime mechanism | `packages/core/src/application/workspace.ts`; `domain/workspace.ts:INSTRUCTION_FILES`; scoped search of core/knowledge/gateway/MCP source | The opening reads AGENTS/CLAUDE/README. No SKILL.md discovery/matching/injection path was found in that source surface, despite docs/10 and docs/08 describing matching skills. |
| K1 | P1, incomplete Phase 5 scope | `packages/knowledge/src/application/search.ts:queryOf`, `vault-tools.ts:NO_PERSONAL`; docs/11 | Personal reads/writes/search return not_found. Choosing the personal folder and its guarded access path are not implemented by these callers. |
| K2 | P1, incomplete Phase 5 scope | `packages/knowledge/src/search-module.ts:MANIFEST`, search fusion and CLI composition; docs/11 | Current search provides workspace-note keyword/vector retrieval, not native code-graph/backlink/rerank integration. Do not describe the existing useful search as wholly absent. |

Sidebar text sizing/clipping remains a follow-up observation from the older
critique, not a newly reproduced defect. Native screen-reader, Turkish and
external-account behavior must not be inferred from source or English screenshots.

## Approach

1. **Recommended: finish daily workflows, then verification and bounded context.**
   Preserve Theia's native editing/tools and METE's current model/permission
   contracts. Fix discoverability without rebuilding existing foundations.
2. **Security first only:** prioritize a distributable experimental package,
   but it does not resolve the user's difficult workflow or missing context.
3. **External engines first:** defer. This crosses the current Phase 5 boundary
   and adds integration work before the native experience is complete.

The recommendation is U3-U5, then G and S, then K. Release-security investigation
can run alongside disjoint source work; dependency installation and final
packaging remain serialized. Phase 6 triggers, external engines, replay,
learning router and automatic memory consolidation remain excluded.

The refreshed sources inform the plan without being copied:

- Codex separates bounded discovery from matching/injection: S-D must specify
  all three, instead of treating a skills directory as a completed capability.
- CrewAI distinguishes typed output, actual checks and persisted state: G-D
  needs separate evidence for these, not a single completion label.
- ChatDev makes human review an explicit input point: retain ADR-181's stronger
  exact task identity and independent-work semantics when improving G-U.
- TokenEconomizer describes accumulated evidence and reversible intervention:
  use provenance as a review criterion, not its defaults or savings claims,
  and do not import automatic settings writes or Phase 6 learning.
- Theia supplies native preferences and extension management: U4 should expose
  existing actions through search, not build a second settings or extension host.

## Package-Sized Slices

| Slice | Owner / package | Proposed outcome | Decision / dependency | Final evidence |
| --- | --- | --- | --- | --- |
| U3 | Sol / ui-theia | Show the last model observed for the displayed run outside diagnostics. Keep automatic/inherited preference separate; never label a historical model as a guaranteed next model. | Approve exact placement; retain current events and model semantics. | Known/unknown/fallback/history unit cases; long names and keyboard at narrow/wide sizes in three themes. |
| U4 | Sol / ui-theia | Search translated group hints and linked action labels as well as today's fields. No settings values, secrets or remote search. | Explicitly extend docs/13 search scope. | Theme/extensions/Turkish/unknown matches; correct group navigation; no draft loss. |
| U5 | Sol / ui-theia | Distinguish no conversations yet from no search results, preserving error/loading/no-folder states and the existing start action. | Approve copy only; no new tutorial or backend behavior. | Empty query, nonempty query, loading/error/retry assertions and final keyboard flow. |
| G-D | Lead / docs | Specify missing-gate and unsupported-expect outcomes, migration, evidence identity and user override rules. Correct the stale docs/08 sentence separately from changing semantics. | New accepted ADR before implementation. | No ambiguity between ran/pass/fail/not-run; existing optional-module degradation addressed. |
| G-C | Lead / contracts | Define only the versioned verification outcome needed by G-D. | G-D; schema/event/version rules. | Contract fixtures for actual success, refusal, missing adapter and unsupported condition. |
| G-E | Sol / core | Enforce the accepted outcomes through existing gate and task flow. | G-C; do not invent an expect expression language. | Missing adapter cannot become an unqualified pass; retries, policy waits and restore covered. |
| G-U | Sol / ui-theia | Present gate outcomes with their actual evidence in task details. | G-E; separate ui-studio slice if its public fold changes. | Not-run, passed and failed states visibly distinct; source/log navigation. |
| S-D | Lead / docs | Specify trusted skill scope, explicit/description matching, conflict order, path/size bounds, taint and user disable behavior. | Missing decisions require ADR; no automatic configuration writes. | Worked valid/invalid/collision examples; no claim that upstream trust rules fit METE unchanged. |
| S-C | Lead / contracts | Define narrow discovery/selection/context shapes required by S-D. | S-D. | External frontmatter parsed with Zod; invalid source and authority escalation refused. |
| S-E | Sol / core | Load only the selected eligible instructions within the accepted context budget. | S-C; no provider/tool names in core. | Missing/corrupt/ignored/changed skill; deterministic ordering, cancellation and no blanket injection. |
| S-U | Sol / ui-theia | Show which skill was used and its source; allow the specified user controls. | S-E and accepted UI design. | Truthful loaded/not-loaded state; navigation and errors; no automatic installation. |
| K-D | Lead / docs | Resolve personal-vault onboarding/policy, graph contract, important-query rerank and stale-source decisions. | ADR-144 scope exists; caller/API details must not be guessed. | Clear read/write/privacy boundaries and migration plan before code. |
| K-C | Lead / contracts | Version only the missing graph/search interfaces agreed in K-D. | K-D. | Compatibility kits and source provenance. |
| K-P | Sol / knowledge | Implement guarded personal-vault access, then retrieval as separate sub-slices. | K-C; compose UI/CLI choices in separately owned slices. | Workspace isolation, private/malformed notes, paths, permission denial and no copying personal content into workspace. |
| K-G | Sol / knowledge | Incremental structural graph, split by indexing/storage/query concern. | K-C and dependency ADR if required. | Rename/delete/hash-stale/ignore/parser-failure cases; Windows/Linux paths. |
| K-R | Sol / gateway, then knowledge | Add routed rerank, then combine graph/backlink/rerank sources in a separate package slice. | K-G and versioned caller needs. | Missing adapter, timeout/quota, stable fusion and provenance; no model calls in tests. |

The six security migration investigations remain separately proposed in
`2026-11-08-remaining-release-security.md`. No blanket Zod major override,
archive-package alias, advisory ignore, shortened age rule or changed golden
output is approved by this plan. The deepmerge item is now advisory-data
reconciliation: its CVE authority rejected the record on November 2, so the
retained scanner finding is not independently confirmed vulnerability evidence.

## End-Only Validation

Write/update the regression cases before their implementation; do not execute
them, build the desktop or open an IDE while the agreed development pass continues.
Review source and assertions during development. Then, in one final validation
stage, run focused suites and `pnpm check`, followed by the required Electron,
accessibility and release checks. Where release:check already owns a suite, do
not add a redundant manual full-suite run. Debug and rerun only necessary failures
within that final stage; do not claim a predetermined number of launches or passes.

Keep all thirteen gates mandatory. Publish only after they pass, identify and
hash the final package, then verify the installed 0.0.0 public-feed download
without install-on-quit. Do not overwrite the baseline or user data to make a
test convenient. Signed update, Linux and human acceptance are separate gates.

## Approval Boundary

The user approved U3-U5 as the next concrete development batch and the ordered
G/S/K design investigations. That does not automatically accept an unwritten ADR,
public API shape, new dependency or Phase 6 feature. Bring only those concrete
missing decisions back for approval. Final validation remains deferred until
the agreed development scope is finished.

## Current Batch

| Slice | Owner | Status | Write ownership |
| --- | --- | --- | --- |
| U3 | Sol / Schrodinger + lead | verified, Windows source build | Conversation model evidence, chat header/style and focused regression tests |
| U3.1 | lead + Astra / Epicurus | verified, source/unit | Same acknowledged preference state as picker; pending/refused/navigation/clear-saved regressions |
| U4 | Sol / Banach | verified, Windows source build | settings-groups.ts and settings-groups.test.ts; search/draft preservation in Electron |
| U5 | Sol / Mill | verified, Windows source build | thread-list-view.tsx and view regressions; empty/search states in Electron |
| Integration | lead + Astra / Epicurus review | verified within batch scope | ADR-186/docs, EN/TR resources, Changeset, pnpm check 34/34 and final combined Electron 1/1; see review |
| G-D | lead | policy and compatibility approved, ADR-187 | All new runs strict, saved unmarked runs legacy; no user-template rewrite |
| G-C/E/U | lead + Sol / Dirac, Lagrange, Volta; Astra / Heisenberg review | verified on Windows source build | Final check 34/34; core 666, UI 951, CLI 220 tests; bundle and combined Electron 1/1; `docs/reviews/2026-11-08-verification-evidence.md` |

No worker may execute tests/builds or launch the IDE. Tests are authored before
their matching code changes; unexecuted tests are not called RED or GREEN.
The lead owns the single final validation stage after all three slices and
the corresponding documentation/integration are complete.

Batch evidence and explicit remaining platform/release/sidebar boundaries:
`docs/reviews/2026-11-08-conversation-discovery.md`. The first final Electron
attempt stopped at an ambiguous test selector; the corrected single-scenario
rerun passed. No implementation-time IDE launch or test run occurred.
