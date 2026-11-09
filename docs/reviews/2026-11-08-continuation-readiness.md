# Competitor-Informed Continuation Readiness

Date: 2026-11-08, Europe/Istanbul.
Chat: `01a1bb28-b67b-7962-96a6-df22b364a89c`.
Status: M1 verified for Windows source/offline composition; independent review closed.
Owner: main lead. Only ADR-188/M1 is adopted for completion in this chat.

## Current Baseline

- HEAD is `c5d02494f65abd3709ecd8c559b8fb5dfde43d4b`, on `main`.
  The working tree includes extensive pre-existing changes; HEAD is not their
  identity. The initial investigation edited none of those files; subsequent
  approved M1 work is recorded below. User configuration/data remain untouched.
- The previous matching chat, `01a1baff-fa38-7981-aeda-0c90edca0be0`, has an
  interrupted continuation turn. Its user approved M0/M1 with "devam et".
  This investigation read that history but did not message or resume its workers.
- Its [plan][prior-plan] and [review][mcp-review] leave review corrections and
  final checks unfinished. Do not interpret that ledger as active workers in
  this chat or overwrite its ownership.
- The [accepted decision][adr188] still defines the narrow MCP delivery.
  The [roadmap][roadmap] remains Phase 5. Skill trust/API decisions and later
  knowledge work are not implicitly approved by M1.
- No trusted hook brief or operational ledger path was supplied. This note is
  a manual record, not proof of automatic recovery or reminders.

## Rechecked Local Evidence

| Area | Observation | Boundary |
| --- | --- | --- |
| MCP bridge | [Tool registration][registration] now calls the search helper. [The helper][bridge] resolves current capabilities, validates results, masks individual strings and handles cancellation. | The old unconditional Phase 4 placeholder is no longer the current implementation. Presence of code is not acceptance. |
| Pending corrections | The helper contains discriminated refusal validation and per-string masking. [MCP tests][mcp-tests] cover escaped strings and malformed refusals; [composition tests][cli-tests] generate a CRLF PEM and assert its presence before masking. | Source evidence of corrections exists. No fresh independent verdict or executed regression result was established here. |
| Skills | [Instruction discovery][instructions] names AGENTS.md, CLAUDE.md and README.md. Searches across packages/apps found no dedicated SKILL.md runtime discovery/selection path. | Limited source finding, not an executed product test. [docs/10][tools] and [docs/08][teams] already require skills. |
| Skill trust | [SECURITY.md][security] explicitly keeps `.mete/skills/` agent-writable. | Finding a file cannot by itself authorize it to change policy or become trusted higher-priority instructions. |
| Personal vault | [Search][search] and [vault tools][vault] still refuse personal scope. | Existing workspace keyword/vector search is useful and must not be described as absent. |

SHA-256 identities of the inspected unfinished M1 files:

| File | SHA-256 |
| --- | --- |
| `packages/mcp/src/application/knowledge-search.ts` | `b85d89abaf3a07732ac62af3330f54747af713f77b79be115e7160e898e629f7` |
| `packages/mcp/test/mcp-knowledge.test.ts` | `f5e2e6e3deaad51938a248bf4b07f5196441a842a4fd2b970f4a7bb6b0e1e768` |
| `apps/cli/test/mcp-knowledge.test.ts` | `bb81cbfeba0a2e0297e02afbbc2c800cdbdbdda199ff8aa07fa53ccb8d9f81f54` |

Recheck these files and any live ownership before dispatch; these hashes are an
inspection snapshot, not a complete working-tree fingerprint.

## Primary-Source Comparison

Official pages below were fetched on November 8. This is a focused workflow
comparison, not a latest-release survey, benchmark or feature-parity claim.
No upstream code or prose was copied.

| Reference | Documented behavior | METE implication, not an upstream claim |
| --- | --- | --- |
| [OpenAI skills][openai] | Names/descriptions are exposed first; complete instructions load when relevant or explicitly invoked. Skills describe workflows; MCP owns authentication, authorization and actions. | Separate discovery, selection, context loading and policy. Do not grant permissions merely because a skill requests tools. |
| [Claude Code skills][claude] | Supports explicit-only invocation, on-demand bodies and context persistence. Its `allowed-tools` field can pre-approve tools for the invoking turn. | Invocation controls are useful reference behavior; upstream permission semantics must not be copied into METE's agent-writable skills. |
| [Agent Skills integration][standard] | Describes bounded discovery, collision handling, repository trust and progressive disclosure. It also suggests permissive metadata recovery for compatibility. | Specify METE's trust, collision and source-change rules. Permissive parsing is not permission to bypass METE's Zod boundary or invent malformed-file behavior. |
| [Cline MCP][cline] | Its quick start ends with checking tool visibility and performing a tool call. | M1 acceptance needs successful retrieval and honest failure/privacy behavior through the actual MCP path, not tools/list alone. |

The published integration guide's default directories, numerical limits and
trust recommendations are not accepted METE defaults. METE's specified roots
remain workspace `.mete/skills/` and global `skills/` unless a new ADR says
otherwise. No extra network service, paid provider or external engine is proposed.

## Recommended Sequence

1. Resume only the interrupted ADR-188 delivery in this chat after the user
   selects it. Review the current corrections instead of reimplementing M1.
2. Resolve remaining review findings in package-sized corrections, then execute
   the final M1 checks. Preserve the existing end-of-development test sequence:
   author tests first, execute after implementation and source review.
3. Design skill discovery, activation and provenance next. Return the concrete
   missing decisions for approval before new contracts or runtime code.
4. Keep personal-vault access, structural graph, backlinks and reranking as
   subsequent separately approved slices. No Phase 6 promotion.

Alternatives: starting skill design now is possible but leaves an unfinished
delivery behind; release-only work addresses distribution rather than these
runtime gaps. The recommendation closes the existing delivery first.

## Current Ownership

The user selected this continuation on November 8. Old workers and operational
state remain outside this chat; the rows below track only the adopted M1 scope.
The installed tool exposes the requested `lead_code` and `lead_review` roles;
that availability is not proof of a live model run.

| ID | Owner | Files owned | Dependency | Done criterion / verification | Status |
| --- | --- | --- | --- | --- | --- |
| C0 | Main lead | This note only | None | Current source, interrupted turn and official references inspected | verified for source inspection |
| M1-R | Astra / Dirac | Read-only M1 diff/tests and ADR-188 | User selected this continuation | Source, corrected assertions and completed raw logs reviewed; no remaining M1 finding | verified with platform/release caveats |
| M1-F | Sol | MCP helper/tests only, if review requires a correction | M1-R | No production correction was needed | cancelled, not needed |
| M1-C | Sol / Boyle | CLI composition test only | M1-R | Native composition passed 6/6; independent recheck closed the ignore-transition gap | verified |
| M1-V | Main lead | Integration evidence and new chat ledger | Corrections and review finished | Focused MCP 33/33, CLI 6/6 and `pnpm check` 34/34; raw output and final hunks inspected | verified for source/offline composition |
| S-D | Main lead; Astra / Heisenberg design review | Proposed skill spec and ADR-189 | Trust principle approved after M1 | S1/S2 separated; P1 daemon-lifecycle gap corrected/rechecked; reviewer closed; technical approval pending | implemented as proposal only |

No ownership of the previous chat's operational state is claimed. Only the
selected M1 scope is copied into this chat's ledger. Keep shared docs and
integration lead-owned. Use at most three workers, disjoint writes, no nested
fan-out and no parallel test/build owner.

## M1 Continuation Evidence

- User approved takeover with "devam et". The native `lead_review` role started
  Dirac (`01a1bb35-90c1-70d2-8a62-32e064dcf4fd`) for a read-only source review.
  No previous worker was resumed and no other chat was messaged.
- Main checked the existing Changeset, docs, conformance refusal query, package
  scripts and TypeScript references. CLI tests import built workspace packages,
  so final validation must build the CLI's dependency graph before composition
  tests; stale `dist` is not valid evidence for new source.
- Initial targeted Biome source check: exit 1, four formatting/import-order
  diagnostics across the MCP helper, MCP regression and CLI regression.
  Evidence: `.probe-mcp-knowledge-resume-biome-initial.log`.
- Main applied only Biome's safe formatting/import organization to those three
  files: exit 0, three files fixed, no intentional behavior/assertion change.
  Evidence: `.probe-mcp-knowledge-resume-format.log`. The earlier file hashes
  identify the pre-format inspection, not the final validated source.
- Behavioral tests and builds were held until source-review completion.
- Dirac's source gate found no confirmed blocking defect. It identified one P2
  coverage gap, not a demonstrated leak: the native composition test covers a
  public indexed note becoming private/deleted but not newly ignored.
  Main confirmed that gap in the current parametrized test.
- Dirac was closed after its source handoff. Native `lead_code` worker Boyle
  (`01a1bb43-7db1-7581-97bd-5f9fb474def7`) owns only the CLI test correction.
  No production edit is requested: mutate only the isolated fixture's ignore
  file, retain the same running app and verify both searches stop finding it.
- Boyle added the fixture helper and `ignored` case, reporting 12 added and four
  replaced lines. Main inspected the actual changes: only tempRepo's
  `.meteignore` is appended through Node APIs, the app is not restarted and all
  previous assertions remain. Boyle was closed. Final validation starts only
  after this implementation/source-review stage; no behavioral test ran earlier.
- Final-stage `pnpm --filter @mete/cli build`: exit 0.
  Evidence: `.probe-mcp-knowledge-resume-build.log`.
- `pnpm --filter @mete/mcp exec vitest run test/mcp-knowledge.test.ts test/mcp-server.test.ts`:
  exit 0, two files / 33 tests passed.
  Evidence: `.probe-mcp-knowledge-resume-focused.log`.
- `pnpm --filter @mete/cli exec vitest run test/mcp-knowledge.test.ts`:
  exit 0, one file / six tests passed, including the native CRLF secret and
  post-index private/deleted/ignored cases.
  Evidence: `.probe-mcp-knowledge-resume-composition.log`.
- Root `pnpm check` completed with observed exit 0: 1,382 Biome files,
  TypeScript passed, no dependency violations (1,594 modules / 5,910 dependencies),
  63 script tests passed. Turbo: 34/34 successful, 27 cached, 43.604 seconds.
  The changed MCP/CLI suites ran uncached: 311/311 and 226/226 tests passed.
  Evidence: `.probe-mcp-knowledge-resume-check.log`.
- Dirac's assertion/evidence recheck closed the P2 gap with no remaining concrete
  M1 finding. It confirmed the focused logs and retained assertion strength.
  Final independent inspection also confirmed the completed root-check summary,
  uncached MCP/CLI runs and unchanged source/test hashes. Verdict:
  VERIFIED WITH CAVEATS for M1 source and automated evidence. Dirac was closed;
  no worker from this continuation remains open.
- The [delivery report][mcp-review] records commands, raw logs, observed exits and
  SHA-256 identities of seven tested files. No app, test or build process was
  left running by main; installed/real-client/Linux/release acceptance is open.

## Skill Decision Boundary

Recommended design direction, not an accepted specification:

- Metadata-first discovery; load selected content only, with source identity
  visible to the user. Do not inject all skill bodies into every run.
- A skill cannot install dependencies, execute scripts, change models, grant
  permissions or rewrite protected settings merely by being discovered.
- Explicit activation and description matching must be distinct. Eligibility,
  user approval, disabling and changed-file handling require a defined contract.
- Preserve what was actually used across resume/compaction; do not silently
  replace historical content with a subsequently modified file.

The approved docs do not yet define the trust receipt/storage, matching rule,
collision precedence, limits, activation API or revocation policy. These must be
decided before implementation; this note deliberately supplies no guessed API.

## Initial Investigation Checks

- `git diff --check`: exit 0 on the pre-existing tracked diff.
- This note's local links, line anchors, ASCII/LF and whitespace checks passed.
  The three inspected M1 file hashes remained unchanged after this note was added.
- At investigation end, `pnpm check`, tests, builds, IDE launches and release
  checks were NOT RUN. The approved continuation's actual results are above.
- Tavily search failed to emit usable output because of a Windows cp1254
  encoding error. Official-source research continued through the available web
  search/open connector; no login or global configuration was changed.
- The investigation started no worker; the continuation's two workers are
  recorded above. No installation, real model call, commit, push or publication.
- Installed application, external-client acceptance, Linux and release remain
  separate from source and offline-composition checks.

[prior-plan]: ../superpowers/plans/2026-11-08-competitor-gap-next-slices.md
[mcp-review]: 2026-11-08-mcp-knowledge.md
[adr188]: ../adr/188-mcp-workspace-knowledge-search.md
[roadmap]: ../../ROADMAP.md
[registration]: ../../packages/mcp/src/application/mete-tools.ts#L163
[bridge]: ../../packages/mcp/src/application/knowledge-search.ts#L20
[mcp-tests]: ../../packages/mcp/test/mcp-knowledge.test.ts#L151
[cli-tests]: ../../apps/cli/test/mcp-knowledge.test.ts#L156
[instructions]: ../../packages/core/src/domain/workspace.ts#L13
[security]: ../../SECURITY.md#L73
[search]: ../../packages/knowledge/src/application/search.ts#L163
[vault]: ../../packages/knowledge/src/application/vault-tools.ts#L49
[tools]: ../10-tools-mcp-runtimes.md#L234
[teams]: ../08-orchestration-and-teams.md#L218
[openai]: https://developers.openai.com/plugins/concepts/skills
[claude]: https://code.claude.com/docs/en/skills
[standard]: https://agentskills.io/client-implementation/adding-skills-support
[cline]: https://docs.cline.bot/mcp/mcp-overview
