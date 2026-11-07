# Reference feature matrix

Date: 2026-11-07, Europe/Istanbul. Purpose: bounded source research for the lead's
prioritized, package-sized plan, not implementation or release acceptance.

METE baseline inspected: `ac41090712762cb3eb7849e836b7449985947706`
(2026-11-07T02:07:03+03:00), plus the concurrently changing working tree.
Local observations were collected through approximately 03:20 +03:00.
Uncommitted ADR-180 files are included as work in progress; HEAD alone does not
identify their contents. Recheck their line numbers after the main QA pass.

## Scope and evidence rules

- Exactly 25 feature families below, selected for orchestration and daily IDE use.
  This is not an exhaustive upstream survey or one-to-one feature-parity claim.
  Row order groups related concerns; it is not a prioritized implementation plan.
- Read the glossary, architecture, kernel rules, contribution rules, current
  roadmap, orchestration/UI specifications, relevant accepted ADRs, ADR-180
  design, and [the earlier review](2026-11-07-code-review.md). Its historical
  passing checks are context, not independently rerun evidence for this matrix.
- Upstream evidence is first-party README, documentation or source at fixed
  revisions. GitHub API commit metadata and raw source retrieval returned HTTP
  200 for the cited source files. Commit timestamps are not release dates.
- `implemented`: the bounded behavior has a concrete code path; not an acceptance
  PASS. `partial`: only part of the family exists, or ADR-180 integration/UX
  acceptance remains open. `absent`: no implementation was found in the stated
  search surface. `Phase6+`: explicitly deferred by the roadmap; not authorization
  to start it. Test links mean assertions exist, not that tests ran here.
- No tests, builds, model calls, installations, account changes, source edits,
  commits or publication were performed. Only this research document was added.
  No upstream code or prose was copied into METE implementation.

## Revision ledger

The seven repository tips were returned by GitHub's commits API on 2026-11-07.
These identify the inspected snapshots, not the newest released products.

| Reference | Inspected revision | Commit timestamp, UTC | Qualification |
| --- | --- | --- | --- |
| OpenBMB/ChatDev | [464a681ba7bda869db97a50c5fa707c9a0fb57a0](https://github.com/OpenBMB/ChatDev/commit/464a681ba7bda869db97a50c5fa707c9a0fb57a0) | 2026-10-30T12:36:43Z | Main README identifies DevAll 2.0; classic ChatDev, MacNet and puppeteer are separate branches. |
| crewAIInc/crewAI | [7abc196a176a5552c35c6e7a16817aa115f10655](https://github.com/crewAIInc/crewAI/commit/7abc196a176a5552c35c6e7a16817aa115f10655) | 2026-11-06T05:56:57Z | Selected `docs/edge/en` pages are development documentation, not a stable-release guarantee. |
| FoundationAgents/MetaGPT | [11cdf466d042aece04fc6cfd13b28e1a70341b1f](https://github.com/FoundationAgents/MetaGPT/commit/11cdf466d042aece04fc6cfd13b28e1a70341b1f) | 2026-01-21T10:12:32Z | OSS README scope only; no inference from the separate hosted MGX product. |
| openai/codex | [e0aa0434f415b0c5bc0fb64abd7f03c5510f9ed6](https://github.com/openai/codex/commit/e0aa0434f415b0c5bc0fb64abd7f03c5510f9ed6) | 2026-11-06T23:50:54Z | Selected Rust protocol, skills discovery, compaction and app-server documentation. |
| microsoft/TokenEconomizer | [0aa2aca2423328863fe52a0beef0ed6323ff1e63](https://github.com/microsoft/TokenEconomizer/commit/0aa2aca2423328863fe52a0beef0ed6323ff1e63) | 2026-11-06T20:41:57Z | Mechanism descriptions, not reproduced benchmarks or verified host compatibility. |
| eclipse-theia/theia | [8179891fc92c56cc10a6ff0f61d2a139dfeb8b41](https://github.com/eclipse-theia/theia/commit/8179891fc92c56cc10a6ff0f61d2a139dfeb8b41) | 2026-11-06T16:16:53Z | Observed tip; not METE's installed version. |
| Theia matching METE | [d8106d7ffa62b3413ff1ca5b63a0e6c2fe0b0649](https://github.com/eclipse-theia/theia/commit/d8106d7ffa62b3413ff1ca5b63a0e6c2fe0b0649) | 2026-09-24T14:33:43Z | API resolution of tag `v1.76.0`; native package references below use this revision. |
| microsoft/vscode | [a9afb7c8531af5da786ef291bec02926c9189ee6](https://github.com/microsoft/vscode/commit/a9afb7c8531af5da786ef291bec02926c9189ee6) | 2026-11-07T00:07:25Z | Source reference for editing, preferences and tasks; no claim METE embeds this VS Code version. |

## Matrix

Local links are repository-relative. `L` numbers refer to the inspected working
files, not a pinned committed version. User value is analysis, not an upstream
performance claim.

| ID / feature family | Verified upstream reference and bounded fact | METE source and assertion pointers | Status and boundary | User value |
| --- | --- | --- | --- | --- |
| F01 Role-based SOPs and declarative teams | [MetaGPT README][meta] describes specialized software-company roles and SOPs. [CrewAI README][crew] documents roles, tasks and explicit processes. | [Template schema](../../packages/contracts/src/domain/template.ts), L114/L262; [task context](../../packages/core/src/domain/team-run.ts), `taskConversation`; [template tests](../../packages/contracts/test/domain/template.test.ts). | **implemented**: native validated templates, roles, context and artifacts. CrewAI's inspected README now leads with JSONC and retains an older YAML scaffold; that is not a reason to replace METE's accepted YAML contract. | Repeatable teams with explicit ownership and outputs. |
| F02 Dependency-aware parallel work | [CrewAI tasks][crew-tasks], L55-57, describe task context and async execution. [ChatDev dynamic execution][chat-dynamic], L3-36, describes bounded fan-out/reduce. | [Scheduler](../../packages/core/src/application/parallel-scheduler.ts), L24-31/L91/L128; [overlap/slot/dependency assertions](../../packages/core/test/application/parallel-scheduler.test.ts), L19; [lifecycle assertions](../../packages/core/test/application/scheduler-lifecycle.test.ts), L20/L62. | **partial**: ADR-174 currently overlaps at most two non-writing model calls, excluding clarification and best-of-N. Writers, tool execution and coordinator conversations remain sequential. Active-run approvals, task-local waits and parallel writer/merge queues are not complete. | Shorter independent research without corrupting shared work or hiding waits. |
| F03 Dynamic task decomposition | [CrewAI hierarchy][crew-hierarchy], L20-26, describes manager delegation and validation; [MetaGPT][meta], L40-48, describes PM/engineer handoffs. | [Spawn validation and expansion](../../packages/core/src/domain/spawn.ts), `withSpawned`; [approval integration](../../packages/core/src/application/spawned.ts), `afterApproval`; [spawn regression](../../packages/core/test/application/spawn-engine.test.ts), L48. | **implemented**: approved `task-list@1` expands into tasks of the same run with known roles/dependencies. Not arbitrary recursive teams or ChatDev's general subgraphs. | A reviewed plan becomes executable work without manual re-entry. |
| F04 Human clarification and approval | [ChatDev human node][chat-human], L3/L15-33, describes waiting for input and review loops; [CrewAI tasks][crew-tasks], L57, exposes human review. | [Clarification](../../packages/core/src/application/clarify.ts); [approval handling](../../packages/core/src/application/approvals.ts); [clarification assertions](../../packages/core/test/application/clarify.test.ts), L53/L100/L127; [desktop inbox scenarios](../../apps/desktop/e2e/run-flow.e2e.ts), L87/L123. | **implemented** for bounded task questions, human gates and revisions. Do not extend this label to F02's unfinished task-local waits while other work continues. | Resolve ambiguity and inspect work before it lands. |
| F05 Pair review and alternative attempts | [ChatDev's recreated classic workflow][chat-review], L137-158/L497-598, has reviewer/programmer cycles with loop counters. | [Review rules](../../packages/core/src/domain/review.ts); [attempt execution](../../packages/core/src/application/attempts.ts); [pair assertions](../../packages/core/test/application/pair-review.test.ts), L35; [attempt/judge assertions](../../packages/core/test/application/attempts.test.ts), L119/L286/L342. | **implemented**: bounded pair review plus METE's own sequential best-of-N and judge selection. Best-of-N is a METE complement, not claimed as equivalent to the cited ChatDev loop; attempts do not run concurrently. | Catch mistakes and compare checked alternatives without unbounded retries. |
| F06 Typed outputs and executable verification | [CrewAI tasks][crew-tasks], L63-67/L299-309, documents structured outputs and guardrails. | [Guardrail parser](../../packages/core/src/domain/guardrail.ts), `checkReport`; [actual gates](../../packages/core/src/application/verify.ts), L52-64/L94; [gate assertions](../../packages/core/test/domain/verify.test.ts), L36; [team integration assertions](../../packages/core/test/application/team-engine.test.ts). | **partial** family: schemas and command/capability calls exist. An existing capability is called; only an unavailable capability adapter is skipped with a warning. `expect` is not evaluated. `expected_output` alone is not a guardrail. See stale-doc correction below. | Machine checks instead of trusting a model's completion statement. |
| F07 Persisted execution, recovery and rollback | [CrewAI flows][crew-flows], L408-452, documents persisted state and distinct resume/fork behavior. [Codex thread schema][codex-threads], L354/L544, separates resume/fork. | [Recovery](../../packages/core/src/application/recovery.ts), L24/L82; [restore](../../packages/core/src/application/restore.ts), L130; [engine assertions](../../packages/core/test/application/engine.test.ts), L675/L939; [snapshot undo/drain assertions](../../packages/core/test/application/snapshots.test.ts), L99/L134. | **implemented** for METE's saved runs, quota timers, uncertain-write recovery and file rollback. File rollback is not conversation rewind; no generic upstream-fork parity is claimed. | Recover work without blindly replaying uncertain side effects. |
| F08 Event-triggered autonomy and learning orchestration | [CrewAI flows][crew-flows], L105-108/L614-616, describes event starts and conditional routing. [ChatDev README][chat], L31-34, reports a learning orchestrator on a separate puppeteer branch; that branch was not evaluated. | [Current classifier](../../packages/core/src/application/route.ts), `routeFor`; [classifier parsing](../../packages/core/src/domain/router.ts), L49; [router tests](../../packages/core/test/domain/router.test.ts); [roadmap](../../ROADMAP.md), Phase 6. | **Phase6+**: scheduled/file/issue/webhook starts and learning router are deferred. The current one-call template classifier and recovered quota timer are not a learning or trigger service. | Unattended work and better routing, only after explicit future acceptance gates. |
| F09 Discoverable task skills | [Codex skill discovery][codex-skills], L55-176, scans skill files; [skills documentation pointer][codex-skill-doc] identifies the product's skills feature. | [Workspace instruction reader](../../packages/core/src/application/workspace.ts), `readWorkspace`; [task context](../../packages/core/src/domain/team-run.ts), `taskConversation`; [opening-context assertion](../../packages/core/test/application/engine.test.ts), L371; [skills specification](../10-tools-mcp-runtimes.md), L192. | **absent** in the searched runtime: top-level AGENTS/CLAUDE/README reading exists, but no `SKILL.md` discovery, description matcher or injection path was found. No runtime skill test found. A registry entry kind or writable skills directory does not implement skills. | Reuse task-specific expertise without putting all instructions in every prompt. |
| F10 Retrieval and code knowledge | [ChatDev memory][chat-memory], L48-50, documents file/vector and append-only stores; [CrewAI memory][crew-memory], L10/L104-106, describes scoped recall before tasks. | [Search module](../../packages/knowledge/src/search-module.ts), L19-28; [search](../../packages/knowledge/src/application/search.ts), `queryOf`/`searchNotes`; [hybrid assertions](../../packages/knowledge/test/hybrid.test.ts), L121/L163; [personal-scope refusal](../../packages/knowledge/test/search.test.ts), L156. | **partial**: workspace-note FTS/vector fusion and keyword fallback exist. Personal-vault search explicitly refuses; native code graph, graph/backlink fusion and rerank caller are not provided by this module. ADR-144 moved these knowledge items into Phase 5; only graph visualization stays Phase 6. | Relevant project evidence with honest degradation instead of invented coverage. |
| F11 Cross-run lessons and learned micro-skills | [TokenEconomizer][economizer], L47-54, describes repeated-evidence facts and contradiction removal; [CrewAI memory][crew-memory], L106, describes extraction after tasks. | [Lesson turn](../../packages/core/src/application/lesson.ts), `lessonTurn`; [retrieval](../../packages/core/src/application/notes.ts), L22; [lesson assertions](../../packages/core/test/application/lessons.test.ts), L72/L128/L145; [note history](../../packages/knowledge/test/history.test.ts), L63. | **partial**: opted-in task lessons, handoffs, retrieval, aging and note restore exist. Repeated-session corroboration, contradiction retirement and automatic micro-skill synthesis are not present. Retrospectives/consolidation stay Phase 6; no claim a saved lesson is a verified fact. | Reduce repeated discovery while preserving provenance and correction. |
| F12 Learned, reversible tool pruning | [TokenEconomizer][economizer], L55-58/L337-353/L368-385, describes evidence-based pruning, proposal mode and restoration through host settings. | [Seat/tool construction](../../packages/core/src/domain/team-run.ts), `activeSeat`; [conversation selection](../../packages/core/src/application/conversation.ts), L24; [selection tests](../../packages/core/test/application/conversation.test.ts). | **absent** as automatic learning. ADR-180's manual Web/MCP group selection is not usage-learned pruning or per-tool selection. Importing upstream's automatic settings-writing strategy would conflict with METE's agent configuration-write prohibition. | Smaller tool context without permanently removing needed capabilities. |
| F13 Repeated-failure intervention | [TokenEconomizer][economizer], L59-64/L390-425, describes a progress-sensitive judge, bounded redirects and a human stop notice. | [Repeat detector](../../packages/core/src/domain/repeat.ts), `guarded`; [exact-repeat assertions](../../packages/core/test/domain/repeat.test.ts), L44/L71; [engine regression](../../packages/core/test/application/engine.test.ts), L782. | **partial**: identical tool/arguments/result repetition gets a deterministic nudge. It is not a cross-session failure model or judge, does not stop the run, and its evidence resets when history is folded. | Warn about wasted calls without misrepresenting progress or stopping useful work. |
| F14 Context compaction and token economy | [Codex compaction source][codex-compact], L85-144, implements replacement history and automatic compaction. | [Compaction/cutting](../../packages/core/src/domain/compact.ts), `toSummarize`/`cutOld`; [engine assertions](../../packages/core/test/application/engine.test.ts), L429/L468/L485/L505; [pure assertions](../../packages/core/test/domain/compact.test.ts). | **implemented**: model-window-aware folding, preserved opening/recent turns, aged long-result cutting and bounded too-large retry. No benchmarked cost/success improvement for METE was established here. | Longer useful conversations under limited provider context and quota. |
| F15 Continuous conversation and session navigation | [Codex thread schema][codex-threads], L62/L354/L544, defines start/resume/fork; [app-server notes][codex-server], L26-34, distinguish history and new forks. | [Saved-history reply](../../packages/core/src/application/reply.ts), L25; [conversation session](../../packages/ui-theia/src/application/conversation-session.tsx), `createConversationSession`; [race/duplicate assertions](../../packages/ui-theia/test/conversation-session.test.ts), L42/L68/L99; [two-turn desktop scenario](../../apps/desktop/e2e/conversation.e2e.ts), L18. | **partial** family / ADR-180 WIP: completed single-agent replies create immutable successor runs with history; active/failed/team sources are refused. No general fork, steer or unified-history-management parity. Main owns final UX QA. | Ask a follow-up without losing context or navigating to a stale response. |
| F16 Discover, configure and authorize MCP tools | [Codex app-server notes][codex-server], L532-574, document server capability/status, OAuth and configuration reload surfaces. | [Guided parser](../../packages/ui-theia/src/application/tool-setup.ts), L168/L195; [catalog](../../packages/ui-theia/src/application/tool-catalog.ts), L30; [activation](../../packages/ui-theia/src/application/tool-activation.ts), L19; [activation assertions](../../packages/ui-theia/test/tool-activation.test.ts), L22/L33/L45; [guided desktop scenarios](../../apps/desktop/e2e/usability-tools.e2e.ts), L96/L191/L202. | **partial** / ADR-180 WIP: real search/prepare, draft review, explicit save/connect, loaded-config test and grouped conversation access. Unresolved credentials stay setup-required; status uncertainty refuses restart. Not arbitrary auth import, individual tool selection, or a live-server compatibility certification. | Reach a genuinely usable tool through visible setup and permission states. |
| F17 Visual workflow authoring | [ChatDev README][chat], L229-242, describes a drag-and-drop workflow canvas and runtime inspection; [authoring guide][chat-author], L79-95, describes node types. | [Flow view](../../packages/ui-theia/src/infrastructure/flow-view.tsx), L68-96; [team editor](../../packages/ui-theia/src/infrastructure/team-editor-widget.tsx), L168/L236; [editor assertions](../../packages/ui-theia/test/team-editor-view.test.ts), L200/L241; [YAML preservation](../../packages/ui-theia/test/team-draft.test.ts), L233. | **partial**: visual member/task forms and YAML editing exist; runtime Flow sets `nodesDraggable=false` and `nodesConnectable=false`. It is not a canvas workflow editor. Capability gates remain YAML-only; tab close still has an explicit unsaved-draft limitation. | Understand and edit a team without confusing an observation graph with an authoring surface. |
| F18 Historical event replay | [ChatDev README][chat], L93-94, records classic replay support as historical news, not proof of DevAll's current replay UI. Its current launch view exposes logs/artifacts at L241. | [Event fold](../../packages/ui-studio/src/domain/team-view.ts), L243/L262; [history/live deduplication](../../packages/ui-studio/test/domain/team-view.test.ts), L71; [UI specification](../13-ui-and-studio-view.md), Replay; [roadmap](../../ROADMAP.md), Phase 6. | **Phase6+** for scrubber/speed-controlled replay. Live Board/Flow/Studio and history folding already exist; a deterministic fold is not a finished Replay screen. | Explain how a run reached a state and inspect past approvals. |
| F19 Integrated terminal and working-tree review | [Theia terminal][theia-terminal], L15, provides integrated terminals; [VS Code README][vscode], L17, describes the edit/build/debug workflow. | [Desktop composition](../../apps/desktop/package.json), `@theia/terminal` and built-in Git extensions; [Changes widget](../../packages/ui-theia/src/infrastructure/changes-widget.tsx), L91; [Changes assertions](../../packages/ui-theia/test/changes-view.test.ts); [desktop panel scenario](../../apps/desktop/e2e/panels.e2e.ts), L25. | **implemented** at composition/source level. Changes-panel tests do not establish terminal PTY interaction, Git staging/conflict UX, or platform acceptance. Those remain OPEN in this research. | Review actual edits and run project commands in the same workspace. |
| F20 Tasks, problem navigation and debugging | [Theia tasks][theia-task], L15-17, describes task execution; [Theia debug][theia-debug], L15/L28-36, describes sessions/breakpoints; [VS Code task configuration][vscode-tasks], L91-150/L333-361, includes terminal presentation, dependencies and problem matchers. | [Desktop composition](../../apps/desktop/package.json), `@theia/debug`, `ms-vscode.js-debug`; observed generated `apps/desktop/src-gen/frontend/index.js`, L98-115, loads markers/output/task/debug. Bounded search of `apps/desktop/e2e` found no interactive task/problem-match/breakpoint scenario. | **partial** acceptance, not absent implementation. Task is already in the generated graph even though not a direct desktop dependency. Native build-task -> diagnostic -> source -> breakpoint interaction remains OPEN. Generated files are observations, not edit targets. | Complete the edit-build-debug loop without another application. |
| F21 Editing, navigation and language services | [VS Code README][vscode], L17/L55, distinguishes editing/navigation and language-feature extensions; [Theia README][theia], L53-58, defines IDE and extension-protocol scope. | [Desktop built-in extensions](../../apps/desktop/package.json), `theiaPlugins`; [METE command/menu composition](../../packages/ui-theia/src/infrastructure/shell-contribution.ts), L28/L51; [screen navigation scenario](../../apps/desktop/e2e/panels.e2e.ts), L97. | **implemented** as composed editor/search/language services and METE navigation. No focused go-to-definition, rename or language-service interaction evidence was collected. Optional AI tab completion remains Phase 6, separate from native language completion. | Familiar project navigation and precise editing with less UI relearning. |
| F22 Searchable settings, scopes and compact panels | [Theia preferences][theia-preferences], L15-26, documents precedence/scopes; [VS Code preferences source][vscode-preferences], L55-71/L226-254, registers settings search and opening. | [Settings search](../../packages/ui-theia/src/application/settings-groups.ts), L207; [panel tokens](../../packages/ui-theia/src/application/panel-root.ts); [search assertions](../../packages/ui-theia/test/settings-groups.test.ts); [theme/narrow layout scenario](../../apps/desktop/e2e/usability-layout.e2e.ts), L53; [scope scenario](../../apps/desktop/e2e/settings-scope.e2e.ts), L5. | **partial** / ADR-180 WIP: compact neutral operational surfaces, persistent composer and translated-label/section-ID search are present. This is not full value-level settings search or a completed usability/accessibility certification. Main's final QA is separate. | Find the right setting and see which scope will change without losing the conversation. |
| F23 Native editor extension management | [Theia Open VSX extension][theia-vsx], L15-21, provides registry integration. | [Native discovery wrapper](../../packages/ui-theia/src/infrastructure/extension-discovery.ts), L8/L19/L38/L47; [discovery assertions](../../packages/ui-theia/test/extension-discovery.test.ts), L114/L131/L138; [desktop discovery scenarios](../../apps/desktop/e2e/usability-extensions.e2e.ts), L108/L155; [dependency](../../apps/desktop/package.json). | **partial** / ADR-180 WIP: native view, intentional search and restored-tab guards. The inspected E2E displays an Install button but does not click it or prove install/activation/uninstall. Public marketplace, VSIX lifecycle and packaged behavior stay OPEN. Extensions are not METE-policy-sandboxed agent tools. | Install language/editor support through familiar controls and a truthful trust boundary. |
| F24 Optional external team engines | [CrewAI][crew], [MetaGPT][meta] and [ChatDev][chat] are distinct frameworks/platforms; their existence is not proof of METE adapters. | [Empty engine module](../../packages/engines/src/module.ts), L1-3; [empty public index](../../packages/engines/src/index.ts), L1-2; [test command](../../packages/engines/package.json), `--passWithNoTests`; [template enum](../../packages/contracts/src/domain/template.ts), L114. | **Phase6+**, implementation absent: module and public API are empty stubs. Template enum acceptance and a package test command cannot establish an adapter, gateway enforcement or event parity. No runtime adapter assertion found. | Optional workflow reuse later, while preserving METE's native engine and gateway boundary. |
| F25 Media/game pipelines and artifact inspection | [ChatDev README][chat], L284-297, lists research, game and 3D workflows, including explicit external-tool requirements. | [Mapping registration](../../packages/mcp/src/application/provide-mappings.ts), L99; [mapping assertions](../../packages/mcp/test/mappings.test.ts), L72/L106; [asset view](../../packages/ui-theia/src/application/assets-view.tsx); [scripted game scenario](../../apps/desktop/e2e/game-studio.e2e.ts), L180; [built-in template](../../templates/game-studio.yaml). | **partial**: mappings, artifact display and a browser-game template exist. Missing generators yield specifications/placeholders, not generated media. The cited mapping test is web-search mapping, not 3D proof; scripted game acceptance is not real-model output quality. GLB preview/license data are not assumed. | Inspect actual produced files and see missing-tool gaps before treating a pipeline as complete. |

## Planning-critical corrections and limits

1. **Capability-gate documentation is internally stale, not evidence of no code.**
   In [docs/08](../08-orchestration-and-teams.md), the later `spawns` paragraph says
   capability gates are logged and skipped. The earlier verify paragraph and
   [verify.ts](../../packages/core/src/application/verify.ts), L52-64, show the
   actual narrower rule: call a present adapter with `args`, accept an `ok`
   result, skip only `capability_missing`, pause on `approval_required`, return
   other errors as feedback. `expect` remains unused. The smallest documentation
   correction is to align the stale blanket sentence with that rule, not remove
   working capability execution or claim every gate is enforced. Not edited here.
2. **Do not schedule existing foundations as greenfield features.** F02, F05,
   F07, F10, F14 and F19-23 have real code. Scope their missing behavior and
   acceptance separately. Conversely, F09/F12/F24 lack the runtime mechanism;
   a schema field, directory, stub or UI link is not implementation.
3. **Full ADR-174 is still OPEN.** Source eligibility explicitly excludes writers,
   clarification and multiple attempts. A two-model overlap test cannot certify
   parallel tools, independent human waits or approval-ordered writer merging.
   Keep the lead's existing package slices and accepted ADR-174 contract.
4. **Phase boundary is unchanged.** [ROADMAP](../../ROADMAP.md) still places
   triggers, learning router, replay, consolidation, optional external engines,
   optional AI completion and graph UI in Phase 6; community registry/shared
   memory reach is later. ADR-144/162/174 already pulled specific foundations
   into Phase 5. This matrix does not move any further item across that boundary.
5. **Native reuse is not blanket VS Code parity.** METE pins Theia 1.76.0 and
   its built-in VSIX URLs name 1.108.2. Inspected upstream tips may be newer.
   Do not add task/debug/terminal packages merely because a direct dependency is
   missing; inspect the generated composition first. No editor fork or upgrade
   is proposed. Respect ADR-002/029/103 as amended by ADR-180.
6. **Upstream documentation also has limits.** ChatDev's authoring guide describes
   `dynamic` on nodes while its dedicated dynamic-execution guide specifies edges.
   This matrix relies only on their shared fan-out/reduce concept and does not
   endorse a configuration syntax. Classic replay and learning-orchestrator
   claims are explicitly branch/history references, not surveyed DevAll parity.
   CrewAI's inspected memory guide uses a unified API, so older separate-memory
   terminology in METE's inspiration text is not a current upstream API map.
7. **No imported performance or security claim.** TokenEconomizer's savings are
   its authors' measurements, not measured METE savings. Its automatic settings
   writes, CrewAI telemetry and upstream cloud/local-runtime options do not
   override METE's accepted privacy, capability, no-local-model or configuration
   rules. Researching a concept does not authorize installation or code copying.

## Checks performed and open acceptance

- Ran read-only `git status --short`, `git log -1`, targeted `rg`/`rg --files`,
  source reads, and scoped `git diff`/`git diff --stat`. No source reset or rewrite.
- Inspected changed conversation locators, styling assertions and settings tests.
  The selected conversation diff retains both user and assistant history checks;
  changed visual expectations match ADR-180's authorized direction. This is not
  an audit of all changed assertions or all swallowed-error branches.
- Queried official GitHub commit/tree APIs and fetched the fixed-revision source
  files linked below. Failed candidate paths were discarded, not cited as proof.
  Tavily was installed but unauthenticated; no login/account change was attempted.
- No `pnpm check`, package tests, Electron launch, physical-device checks or
  release checks ran, as explicitly requested. Main retains ADR-180 QA ownership.
  All live UI, real provider/MCP behavior, installation/update, Linux/WSL and
  release acceptance remain OPEN unless separately established by the lead.

Verdict: **VERIFIED WITH CAVEATS** for this bounded source-to-code research only.
Not a verdict that METE has all upstream capabilities or has passed Phase 5.

## Pinned primary sources

[chat]: https://github.com/OpenBMB/ChatDev/blob/464a681ba7bda869db97a50c5fa707c9a0fb57a0/README.md
[chat-author]: https://github.com/OpenBMB/ChatDev/blob/464a681ba7bda869db97a50c5fa707c9a0fb57a0/docs/user_guide/en/workflow_authoring.md
[chat-dynamic]: https://github.com/OpenBMB/ChatDev/blob/464a681ba7bda869db97a50c5fa707c9a0fb57a0/docs/user_guide/en/dynamic_execution.md
[chat-human]: https://github.com/OpenBMB/ChatDev/blob/464a681ba7bda869db97a50c5fa707c9a0fb57a0/docs/user_guide/en/nodes/human.md
[chat-memory]: https://github.com/OpenBMB/ChatDev/blob/464a681ba7bda869db97a50c5fa707c9a0fb57a0/docs/user_guide/en/modules/memory.md
[chat-review]: https://github.com/OpenBMB/ChatDev/blob/464a681ba7bda869db97a50c5fa707c9a0fb57a0/yaml_instance/ChatDev_v1.yaml
[crew]: https://github.com/crewAIInc/crewAI/blob/7abc196a176a5552c35c6e7a16817aa115f10655/README.md
[crew-tasks]: https://github.com/crewAIInc/crewAI/blob/7abc196a176a5552c35c6e7a16817aa115f10655/docs/edge/en/concepts/tasks.mdx
[crew-flows]: https://github.com/crewAIInc/crewAI/blob/7abc196a176a5552c35c6e7a16817aa115f10655/docs/edge/en/concepts/flows.mdx
[crew-memory]: https://github.com/crewAIInc/crewAI/blob/7abc196a176a5552c35c6e7a16817aa115f10655/docs/edge/en/concepts/memory.mdx
[crew-hierarchy]: https://github.com/crewAIInc/crewAI/blob/7abc196a176a5552c35c6e7a16817aa115f10655/docs/edge/en/learn/hierarchical-process.mdx
[meta]: https://github.com/FoundationAgents/MetaGPT/blob/11cdf466d042aece04fc6cfd13b28e1a70341b1f/README.md
[economizer]: https://github.com/microsoft/TokenEconomizer/blob/0aa2aca2423328863fe52a0beef0ed6323ff1e63/README.md
[codex-threads]: https://github.com/openai/codex/blob/e0aa0434f415b0c5bc0fb64abd7f03c5510f9ed6/codex-rs/app-server-protocol/src/protocol/v2/thread.rs
[codex-server]: https://github.com/openai/codex/blob/e0aa0434f415b0c5bc0fb64abd7f03c5510f9ed6/codex-rs/app-server/README.md
[codex-compact]: https://github.com/openai/codex/blob/e0aa0434f415b0c5bc0fb64abd7f03c5510f9ed6/codex-rs/core/src/compact.rs
[codex-skills]: https://github.com/openai/codex/blob/e0aa0434f415b0c5bc0fb64abd7f03c5510f9ed6/codex-rs/ext/skills/src/loader/discovery.rs
[codex-skill-doc]: https://github.com/openai/codex/blob/e0aa0434f415b0c5bc0fb64abd7f03c5510f9ed6/docs/skills.md
[theia]: https://github.com/eclipse-theia/theia/blob/8179891fc92c56cc10a6ff0f61d2a139dfeb8b41/README.md
[theia-terminal]: https://github.com/eclipse-theia/theia/blob/d8106d7ffa62b3413ff1ca5b63a0e6c2fe0b0649/packages/terminal/README.md
[theia-task]: https://github.com/eclipse-theia/theia/blob/d8106d7ffa62b3413ff1ca5b63a0e6c2fe0b0649/packages/task/README.md
[theia-debug]: https://github.com/eclipse-theia/theia/blob/d8106d7ffa62b3413ff1ca5b63a0e6c2fe0b0649/packages/debug/README.md
[theia-preferences]: https://github.com/eclipse-theia/theia/blob/d8106d7ffa62b3413ff1ca5b63a0e6c2fe0b0649/packages/preferences/README.md
[theia-vsx]: https://github.com/eclipse-theia/theia/blob/d8106d7ffa62b3413ff1ca5b63a0e6c2fe0b0649/packages/vsx-registry/README.md
[vscode]: https://github.com/microsoft/vscode/blob/a9afb7c8531af5da786ef291bec02926c9189ee6/README.md
[vscode-preferences]: https://github.com/microsoft/vscode/blob/a9afb7c8531af5da786ef291bec02926c9189ee6/src/vs/workbench/contrib/preferences/browser/preferences.contribution.ts
[vscode-tasks]: https://github.com/microsoft/vscode/blob/a9afb7c8531af5da786ef291bec02926c9189ee6/src/vs/workbench/contrib/tasks/common/taskConfiguration.ts
