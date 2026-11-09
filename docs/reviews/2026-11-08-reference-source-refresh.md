# REF-N8: bounded primary-source refresh
Date: 2026-11-08, Europe/Istanbul. Scope: five reference patterns, not implementation.
METE HEAD observed: `c5d02494f65abd3709ecd8c559b8fb5dfde43d4b`, with concurrent edits.
Only this file is owned. Main retains implementation inspection and acceptance.

## Evidence boundary
- Reused the exact revisions in [the seven-repository matrix][matrix], not latest
  tips/releases. Refreshed five repositories through seven fixed source files.
  MetaGPT, VS Code and the separate Theia-tip snapshot were not re-surveyed.
- Opened all seven fixed URLs through `web.run`; independently fetched raw bytes
  with Node `fetch`, `Cache-Control: no-cache`. All seven returned HTTP 200 on
  2026-11-08 at 00:06:43-00:06:44 UTC (03:06:43-03:06:44 Istanbul).
- All upstream `L` references below are one-based raw-file lines, including blank
  lines, not the web extractor's renumbered view. Hashes identify fetched bytes.
- Read AGENTS, glossary, architecture, kernel/module rules, CONTRIBUTING, ROADMAP,
  relevant docs/08/10/11/13 and FAQ, targeted accepted ADRs, the approved reference
  plan, research skill and lead worker contract. No nested agents or code copying.
- "Source" reports source content; "Analysis" is this researcher's interpretation.
  Documentation claims were not executed. No performance or security parity claim.

## Fetch ledger
Each linked file embeds the full revision from the existing matrix.

| Source | Raw bytes | SHA-256 |
| --- | ---: | --- |
| [S1 Codex discovery][s1] | 7193 | `0abff062b0115f32f653774189beabb67a440e3d6278ea3f5327052b4b5f2963` |
| [S2 CrewAI tasks][s2] | 42493 | `0ee19ff38cd0224ba98d62f032c340ff93fda03e7ccd51290840a52a6ad462c8` |
| [S3 CrewAI flows][s3] | 47270 | `99e7712e013d2148e9e8ae75e750fcf24b3108c509c1d002f10d20cb76b7736f` |
| [S4 ChatDev human node][s4] | 3223 | `83a5e1a6abe2ccd49c86d938dd385d97dacb627c68a8c8c3960f4b1c588a38e4` |
| [S5 TokenEconomizer README][s5] | 27315 | `be8afe696ce28f3976ab7d06e9605012051072cf93bdc14b660327c67159f795` |
| [S6 Theia preferences][s6] | 2664 | `6a6dc77981475b8d716f23feb912b1b2432087d6a138f9de47edbd0120c2d042` |
| [S7 Theia VSX registry][s7] | 1557 | `091994b06b8cb8f93eefacb29c11c7ac14a57232d93b9bd9e8ef560b776e3dd1` |

## Five bounded facts
### 1. Codex discovery is distinct from runtime skill selection
**Source:** S1 `discover_skills`, L55-118, bounds directory walking by mode,
depth, directories and entries; a missing root returns an empty discovery, while
scan errors/truncation produce warnings. L147-181 collects matching skill paths;
`discover_skill_metadata`, L199-223, retains a probe for uncertain metadata
absence instead of treating an incomplete inventory as conclusive.

**Analysis / Phase 5 relevance:** distinguish discovery, validated metadata,
task matching and context injection when assessing runtime `SKILL.md` support.
[docs/10][tools] L234 specifies workspace/global folders and description matching;
[docs/08][teams] L196 names matching skills in context. A directory or registry
entry alone cannot prove that user workflow. [ADR index][adr] L39 (031) accepts the
format; [plan][plan] K4-K6 still depend on skill scope/permission decisions.
This refresh selects no matching algorithm, trust class, limit or new API.
**Unsupported inference:** S1 alone proves neither task matching/injection nor
METE runtime support. Main must inspect those paths; the old matrix's absence
label is historical, not a fresh finding here.

### 2. CrewAI separates typed output, guardrails and persisted state
**Source:** S2 L62-67 distinguishes `output_json`/`output_pydantic` from guardrails
and bounded retries. L299-309 distinguishes function checks from model checks;
L393-451 describes sequential guardrails, transformed output and retry feedback.
S3 `Flow Persistence`, L408-444, documents class/method `@persist`; L447-481
distinguishes same-identity resume from new-identity fork. L481 explicitly
documents silent fallback when the requested stored state is absent, and warns
that pinning the fork's ID can share another flow's persistence key.

**Analysis / Phase 5 relevance:** use separate evidence for output shape, an
executed check and successful recovery. [docs/08][teams] L179-183 already defines
METE gate/guardrail behavior; missing-capability skips and unevaluated `expect`
are documented boundaries, not upstream permission to call them successful.
G1/G2 in [plan][plan] need their own decision before behavior changes.
ADR-177 ([index][adr] L238) prohibits replaying an uncertain write; persisted
state alone does not establish exactly-once side effects. Keep METE's Zod/Result
and versioned capability boundaries, not CrewAI's Python API.
**Unsupported inference:** these `docs/edge/en` pages are development
documentation, not a stable-release guarantee, a durability test or METE parity.

### 3. ChatDev human review is an explicit blocking input point
**Source:** S4 `Blocking Wait Mechanism`, L15-19, describes showing context,
waiting for user input and forwarding it downstream. L29-33 lists review uses;
L47-77 demonstrates a feedback loop using a keyword-conditioned edge. L114
recommends considering a timeout; it does not demonstrate an implemented timeout.

**Analysis / Phase 5 relevance:** make the review target, artifact and requested
decision visible. Retain METE's bounded pair review (ADR-136), clarification
(ADR-142) and exact task request identity ([ADR-181][parallel], L50-60).
ChatDev's documented workflow pause is not METE's task-local wait: independent
METE tasks must continue under ADR-181. No new review workflow is authorized.
**Unsupported inference:** a human node is not proof of stale-answer rejection,
timeout handling, durable approval identity or an upstream security boundary.

### 4. TokenEconomizer ties intervention to accumulated evidence
**Source:** S5 L47-64 describes facts confirmed across three sessions and retired
after contradiction; tool non-use across multiple sessions; and bounded,
confidence-gated judge redirects followed by a stop notice, not automatic stop.
L337-353 gives idle application and proposal-only pruning; L368-385 distinguishes
host-specific granularity, including Codex capability packages, and restoration.
L390-397 describes a successful-turn baseline and one churn case redirected
without a judge. L408-425 limits stop-notice visibility in headless hosts.

**Analysis / Phase 5 relevance:** evidence provenance, contradiction handling and
reversibility are useful review criteria, not permission to import its defaults.
ADR-166 ([index][adr] L174) explicitly chooses METE's deterministic same-call/
same-result nudge, no judge and no new stop. ADR-144/173 preserve current memory
scope; consolidation and the learning router remain Phase 6 in [ROADMAP][roadmap].
Agent-written `.mete/*.yaml` is prohibited by ADR-072; upstream settings-writing
pruning cannot be transplanted. ADR-180's manual capability selection is a
different mechanism, not learned per-tool pruning.
**Unsupported inference:** no verified-fact guarantee, METE cost reduction,
host-compatibility certification or automatic termination follows from S5.

### 5. Theia 1.76 provides native preference and registry foundations
**Source:** S6 L15-26 documents `Default < User < Workspace < Folder` preference
precedence. S7 L15-27 documents Open VSX integration and registry configuration.
Both use the matrix's `v1.76.0` revision, not its separate Theia-tip revision.
Read-only `createRequire` resolution from `apps/desktop/package.json`, followed
by JSON reads, found `@theia/core`, `@theia/preferences`, `@theia/vsx-registry`
all installed at `1.76.0`; each resolved `package.json` has its version at L3.

**Analysis / Phase 5 relevance:** retain native editor preferences and Extensions
integration under ADR-002/103 as amended by ADR-180; no editor fork or upgrade.
Do not conflate Theia preference scopes with METE's YAML/daemon configuration
precedence ([ARCHITECTURE](../../ARCHITECTURE.md), Configuration).
[docs/10][tools] L225-235 requires user-initiated discovery/installation and says
editor extensions are not METE-policy-sandboxed agent tools. [docs/13][ui]
L39-48 keeps METE's translated-label/section-ID search and visible scope.
**Unsupported inference:** the READMEs and version metadata do not prove METE
settings-search coverage, extension compatibility or install/activation UX.

## Checks, gaps and handoff
- Ran only read-only Git status/HEAD/scoped numstat, targeted file reads/search,
  fixed-source web/raw fetches, SHA-256 calculation and installed JSON reads.
  Raw content stayed in memory; no downloaded source/cache files were written.
- `git diff --no-index --check -- NUL <this-file>`: exit 1, no whitespace diagnostics; new-file diff, not a test result.
- Tavily authentication was unavailable per the task brief; no login attempted.
  One guessed local knowledge-document path failed; `rg --files` resolved
  `docs/11-knowledge-layer.md`, which was then read. All seven raw fetches succeeded.
- No tests, builds, installs, IDE launch, commits, pushes or account changes.
  `pnpm check` was deliberately not run under this task's explicit prohibition.
  No METE implementation/assertion audit or new 25-family inventory was performed.
- Per the user's latest instruction, release session `81895` was cancelled during
  Windows installer work: final release status is **INTERRUPTED**, not PASS.
  No independent release rerun or verification occurred here.
- OPEN: main's current implementation inspection; end-of-development automated,
  live UI, platform/device and release acceptance. No historical green report
  closes these. Next: use these five facts for the already-approved lead review;
  keep G/K decisions and any Phase 6 promotion separately authorized.

Verdict: **VERIFIED WITH CAVEATS** for this bounded reference refresh only.

[matrix]: 2026-11-07-reference-feature-matrix.md
[plan]: ../superpowers/plans/2026-11-07-reference-ide-roadmap.md
[roadmap]: ../../ROADMAP.md
[adr]: ../adr/README.md
[parallel]: ../adr/181-parallel-isolation-and-task-control.md
[teams]: ../08-orchestration-and-teams.md
[tools]: ../10-tools-mcp-runtimes.md
[ui]: ../13-ui-and-studio-view.md
[s1]: https://github.com/openai/codex/blob/e0aa0434f415b0c5bc0fb64abd7f03c5510f9ed6/codex-rs/ext/skills/src/loader/discovery.rs#L55-L118
[s2]: https://github.com/crewAIInc/crewAI/blob/7abc196a176a5552c35c6e7a16817aa115f10655/docs/edge/en/concepts/tasks.mdx#L299-L309
[s3]: https://github.com/crewAIInc/crewAI/blob/7abc196a176a5552c35c6e7a16817aa115f10655/docs/edge/en/concepts/flows.mdx#L408-L481
[s4]: https://github.com/OpenBMB/ChatDev/blob/464a681ba7bda869db97a50c5fa707c9a0fb57a0/docs/user_guide/en/nodes/human.md#L15-L33
[s5]: https://github.com/microsoft/TokenEconomizer/blob/0aa2aca2423328863fe52a0beef0ed6323ff1e63/README.md#L47-L64
[s6]: https://github.com/eclipse-theia/theia/blob/d8106d7ffa62b3413ff1ca5b63a0e6c2fe0b0649/packages/preferences/README.md#L15-L26
[s7]: https://github.com/eclipse-theia/theia/blob/d8106d7ffa62b3413ff1ca5b63a0e6c2fe0b0649/packages/vsx-registry/README.md#L15-L27
