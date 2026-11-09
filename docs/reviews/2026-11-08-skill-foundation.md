# Skill Foundation Delivery

Date: 2026-11-08, Europe/Istanbul.
Status: VERIFIED WITH CAVEATS for Windows source/offline S1 acceptance.
Default cold parallel test timing, Linux, installed-app and release remain OPEN.
Baseline: `c5d02494f65abd3709ecd8c559b8fb5dfde43d4b` plus pre-existing changes.
Initial owner: main lead, chat `01a1bb28-b67b-7962-96a6-df22b364a89c`.
Continuation owner: main lead, chat `01a1bc34-f67a-7852-9f3a-2a3af09710a4`.
User approved ADR-189/S1 with "evet uygula". S2 activation is excluded.

Subsequent S2 design review identified an additional OPEN source finding:
skill mutation admission checks gate/engine continuity but not paired native
provenance. This is a static counterexample, not an exercised plugin exploit;
the historical test results below are unchanged. Track the prerequisite fix in
[S2 design review](2026-11-08-skill-activation-design.md), finding D-R3.

## Plan And Ownership

The [accepted design](../superpowers/specs/2026-11-08-skill-runtime-design.md)
defines package-sized tasks S-C1 through S-V. Main owns shared docs,
composition decisions and final validation. Sol owns bounded code/test slices;
Astra owns independent security and lifecycle review. No worker may run
tests/builds or launch the desktop before final development-stage validation.
Author tests before matching implementation; unexecuted tests are not RED/GREEN.

No automatic hook ledger was supplied; this is a manual operational record.
Preserve all existing dirty work, user settings/data and closed M1 work.
No commits, publication, real model calls or new runtime dependencies.

## Initial Progress

- S-D accepted. Its initial P1 quiesce/retirement lifecycle ambiguity was
  corrected and independently rechecked before technical approval.
- S-C1 source/catalog contracts: implemented by Sol / Dalton; 262 authored lines
  reported before formatting, tests NOT RUN. Main inspected the actual schemas
  and exports; existing verification contracts were preserved.
- S-L1a native root/location helpers: Sol / Singer, implemented (294 lines
  reported); canonical root identity, live ignores, link/hardlink refusal and
  cancellation fixtures authored. Main read the files; execution remains open.
- S-L1b bounded enumeration: implemented (298 authored lines); reader S-L2a is
  complete. An exact 256-entry root is conservatively incomplete.
- S-L2a/b/c reader, module and boundary regressions: implemented (299/181/157
  authored lines plus a 46-line metadata-race follow-up). Main inspected bounded
  reads, held-descriptor checks, current ignores and actual adapter attestation.
  Factory: `createSkillSourceModule({ workspaceDir, globalDir, onAdapter? })`.
  Singer closed; all tests still unexecuted.
- S-C2a trust contracts: implemented (297 authored lines).
- S-C2b protocol-35 contracts: implemented (232 authored lines), including
  session identity, typed read errors and authoritative admitted/result mutation.
- C1-H metadata text correction: implemented (about 70 authored lines); YAML
  escaped NUL/invalid Unicode are rejected without repair. Dalton closed.
- S-A1 private trust store: implemented (281 authored lines, 13 authored cases).
  Main inspected CAS, tombstones and atomic audit rollback code.
- S-A2a preview/status helpers: Sol / Archimedes, running.
- S-P1a strict parser: Sol / Leibniz, implemented (297 authored lines).
  Main inspected byte-hash validation, YAML rejection and safe diagnostics.
- S-P1b/P1c catalog and optional module: implemented, scripted hardening authored.
  Main inspected per-call attestation/identity rechecks and current inspection.
  Factory: `createSkillCatalogModule({ nativeSources, onAdapter? })`.
  Leibniz closed; no behavior/lint/type result is claimed yet.
- S-U0/U1/U2 transport, lifecycle and Settings extension: Sol / Parfit, running
  lint/lifecycle correction and authoring isolated desktop acceptance after the
  initial implementation handoff. No browser/test was launched by the worker.
- S-T1/T2 composition and protocol integration: Sol / Sagan, running in
  the initial handoff is now implemented (44 authored cases); worker closed.
- Native admission integration uses an in-process `{ admitted, result }` receipt:
  after confirmed quiesce, identity/abort failures retain admitted=true, prohibit
  the store write and still retire the captured process. This changes neither
  the existing core gate nor the protocol-35 mutation envelope.
- Dependency refinement: C2 schema definition and A1 private store need C1's
  types, not the finished parser implementation, so they run beside source I/O.
  Management/module integration still waits for the required implementations.
- Main accepted ADR-189 and updated canonical docs/Changeset. UI context is the
  existing Theia operational system; no new identity, palette or assets.
- Remaining code tasks: pending.

## Verification

This section records the interrupted initial implementation. The selected
continuation's executed checks are recorded under Final Validation below.

- Focused suites, `pnpm check`, Electron and WSL2: NOT RUN.
- Installed app, third-party client, Linux packaging and release: OPEN.
- `wsl --list --quiet` exited 0 and listed only `docker-desktop`. There is no
  identified Linux development distribution; no Docker use/install was started.
  Native WSL2 path acceptance remains OPEN, not a Windows-test inference.
- S1 approval state is not evidence that an agent loaded or used a skill.
- Closed contracts/tools/mcp source-only Biome pass initially found formatting,
  path-regex and complexity issues. Main preserved behavior with small helpers,
  strengthened source-scope assertions and added control-character path cases.
  `.probe-skill-foundation-source-format-fixed.log`: exit 0, 33 files.
- Integration formatting exposed size/complexity/ARIA issues. Main corrected
  CLI helpers and moved unchanged model-read wiring into the existing reads file;
  UI corrections remain worker-owned. `.probe-skill-foundation-review-fixes-format.log`
  exited 0 over 24 CLI/catalog files. These are not behavioral test results.

## Independent Review Corrections

Ramanujan reviewed only new S1 code; no M1 or historical check review was requested.
The source gate remains open until these corrections and final evidence are checked:

1. P2 ignored approved source could make the entire inventory unavailable and
   prevent Disable. Security is reconciling native diagnostics with historical
   grants, without making ignored sources eligible. Main authored real-file
   approval/ignore/disable and tombstone/audit assertions.
2. P2 nested full inventory/inspection scans multiplied filesystem work.
   The reviewer confirmed that target-only catalog inspection preserves the
   accepted contract; complete inventory remains required by trust before review
   and again after admission before approval. Main updated catalog/tests.
   Singer implemented bounded activation-local source address hints, never
   cached bytes/root/ignore/FD state, with lifetime and native operation-count
   regressions. Execution remains open.

Main added `apps/cli/test/skill-boundary-regressions.test.ts`: ignored-grant
revocation, limits before review and after preview with zero writes, and a
128-source status bound of at most 3N public byte reads and two list calls.
The catalog-only overflow assertion moved to the trust authority boundary,
not removed from acceptance. No latency saving is claimed without measurement.

Final acceptance must exercise changed bytes/root/ignore after preview; expiry
during admission drain; replaced source/catalog/trust instances; corrupt storage
and atomic audit rollback; stale revision races; stale daemon-session requests
before admission; post-admission failures retiring only their captured process;
and uncertain acknowledgements with no automatic mutation replay. Read/preview
must neither quiesce nor grant permission. Disable must retain a tombstone.
UI must distinguish empty, incomplete, failed and unavailable inventories and
keep full review text accessible without claiming agent use.

## Historical Worker Handles

These are historical handles from the interrupted implementation chat, not
workers owned or restarted by the continuation.

- Singer: `01a1bb75-828a-78e1-8999-1c74ce0757b5`, tools/performance implemented;
  now authoring shared capability kits in packages/testing only.
- Leibniz: `01a1bb7d-d55b-7762-9204-348945e68681`, mcp slices implemented, closed.
- Archimedes: `01a1bb79-768a-7d02-bb60-bde3f92ced8d`, security trust slices.
- Dalton: `01a1bb70-aeff-70e2-b984-b45aac1323b4`, contracts complete, closed.
- Parfit: `01a1bb90-1fdc-7f20-8adb-e08a335dd769`,
  ui-theia transport/controller/view integration.
- Sagan: `01a1bb94-2836-7601-ab0e-09e12f9eb3ed`, CLI composition/protocol.
- Sagan is closed. Ramanujan `01a1bba6-1299-7221-8451-ce3a905e1e2d` is closed
  after source findings and bounded performance-design clarification.

## Selected Continuation

The user explicitly selected the interrupted S1 work for the new chat on
November 8 and repeated that tests must run only after all development finishes.
S2, M1, release work and unrelated dirty changes remain outside this continuation.
Old chat state and workers are not taken over. The current chat uses a separate
manual lead ledger; automatic hook recovery remains unverified.

Fresh read-only worker snapshots showed completed handoffs for Singer,
Archimedes and Parfit, with their chats not loaded. Their authored code is
present, but this does not establish type-check or behavioral success.

| ID | Owner | Current scope | Status |
| --- | --- | --- | --- |
| S1-M | Sol / Boole | Full preview masking, including escaped metadata, in security only | Windows tests passed; source rechecked |
| S1-RS | Astra / Linnaeus | Independent source/catalog/trust/storage review | initial source findings closed |
| S1-RU | Astra / Hubble | Independent UI session/transport/host review | original and cross-workspace source findings closed |
| S1-I | Main Astra | CLI integration and isolated desktop acceptance | Windows tests/Electron passed |
| S1-V | Main Astra | Final checks, build and Electron evidence after development | verified with the conditions below |

Main inspected the CLI admission, protocol, cancellation and composition paths.
The desktop acceptance now also authors an empty-discovery/late-file scenario,
read-only assertions that no runs/model calls were made, and checks for the
persisted disabled grant plus both audit decisions. These checks use only the
fixture's temporary databases and passed in final validation.

Before any desktop execution, the actual user-data hashes were read:

- `%APPDATA%/METE/mete.db`: `56692c1f259a65088d38d28b23ea1dd7d2af1ce0f3286d3f3f22c68347e4728f`
- `%APPDATA%/METE/settings.yaml`: `52419e7913d64e774fde27d9d4acea09fc1527b1beb5b0374af37a28d6b9b90e`

After final Electron validation both hashes still matched exactly. No installed
application replacement or user-profile launch/reset occurred.

## Final Validation

All initial development and independent source corrections finished before the
first test/check command. Subsequent corrections below respond to observed
final-stage failures; there were no implementation-stage tests or IDE launches.

- Sol's bounded source corrections covered escaped YAML preview masking,
  source-qualified refusal diagnostics, overflow receipt visibility, stale
  transport reads, controller recreation and cross-workspace recovery.
- Astra's backend and UI source rechecks closed their findings with explicit
  execution caveats. Source review is not a test result.
- Root check 1 stopped at Biome: 1,482 files, 16 errors (formatting and five
  complexity findings). Main formatted nine specific files and extracted one
  test helper; Sol corrected four security complexity findings. Assertions and
  lint rules were preserved.
- Root check 2 passed Biome and TypeScript but found one dependency cycle:
  `skill-admission -> app -> skill-modules -> skill-admission`. Main replaced
  the unnecessary internal `App` type dependency with the unchanged two-field
  parameter shape. No runtime or public contract change.
- Root check 3 passed Biome, both TypeScript steps, dependency-cruiser
  (1,695 modules / 6,348 dependencies) and all 63 script tests. It failed during
  package tests: two legacy tests still asserted protocol 34 instead of accepted
  protocol 35. They now retain exact version/route assertions for protocol 35.
  Turbo stopped at 21 successful / 29 started tasks, not a complete pass.
- The focused location/reader/boundary run reproduced 6 failures / 42 tests.
  Four were ESM namespace spy setup errors; the location and enumeration
  fixtures now use the repository's existing factory-mock pattern.
  Link/root-race results were diagnosed and corrected in the fixtures, as
  recorded below; expected refusal and plaintext-exclusion checks remain.
- Static Impeccable scan returned `[]` with exit 0. This is not a live visual or
  accessibility verdict. `git diff --check` passed at the recorded checkpoint.
- Fresh WSL listing still contains only `docker-desktop`; native Linux
  acceptance remains OPEN and no Docker/install workaround was used.

Raw logs: `.probe-skill-foundation-resume-check-1.log`, `-check-2.log`,
`-check-3.log`, `-tools-red.log`, `-format.log`,
`-test-fixtures-format.log` and `-design.log` under the same prefix.
The `-inputs.log` fingerprint predates final-stage corrections and must not be
presented as final tested identity. The final source identity and results follow;
installed-app and release acceptance remain OPEN.

## Final Results And Conditions

| Check | Observed outcome | Evidence |
| --- | --- | --- |
| Full `pnpm check` | Exit 0, 34/34 tasks, 0 cached, 2m13.16s; temporary `TURBO_CONCURRENCY=1`, `TURBO_FORCE=true` | `.probe-skill-foundation-resume-check-serial.log` |
| Static/type/dependency gates | Biome 1,482 files; both TypeScript steps passed; no dependency violations, 1,683 modules / 6,352 dependencies | Same full check log |
| Package tests | 3,776 passed; two pre-existing non-Windows-only context-path/link cases skipped on Windows; every S1 skill case ran | Same full check log |
| Script regressions | 63 passed, zero skipped | Same full check log |
| Optional-module chaos | Exit 0, 1/1 scenario, 17.12s; includes omitting the new optional skill modules | `.probe-skill-foundation-resume-chaos.log` |
| Desktop production bundle | Exit 0; browser/node/electron builds each reported zero errors | `.probe-skill-foundation-resume-bundle.log` |
| Source Electron Skills flow | Exit 0, 1/1 scenario, 2.8 minutes, no retry | `.probe-skill-foundation-resume-e2e-1.log` |
| Visual/accessibility | Six captures: Light, Dark, High Contrast at 1366x900 and 700x900; no Skills horizontal overflow; zero serious/critical axe findings in every sampled review state | E2E output folder below |
| User-data preservation | Global database and settings SHA-256 values unchanged | Before/after hashes above |

The full check's relevant package totals are contracts 294, tools 324 plus the
two platform skips, MCP 370, security 227, core 666, CLI 277 and UI 1,011.
The installed Turbo 2.11.8 bundled docs were read before using its supported
temporary concurrency/force variables. No test threshold, deadline, assertion,
coverage rule, runtime dependency or repo concurrency setting was relaxed.

Default parallel checks 4/5 were not successful. Existing short core waits and
real-file/Git tests hit deadlines under simultaneous package execution. Unchanged
focused runs passed (spawn 1/1, lookup/Git 8/8); the full forced serial check then
passed. This establishes the recorded execution condition, not a fix or guarantee
for default cold parallel timing.

The apparent reader race failures had a separate evidenced cause: Windows
returned EPERM before the intended directory replacement happened, and retry
consumed the test's one-shot hook. Corrected fixtures perform actual mutations
while retaining open descriptors and assert mutation completion, one open, exact
refusal, original/replacement-text exclusion and closure. Production reader code
was unchanged. Reader suites passed 30/30 and cached-lookup 15/15 with no skips.
Astra independently checked the raw RED/native/GREEN logs and assertion changes.

The Electron scenario exercises empty discovery without creating skill roots,
late local files, workspace/global name collisions, invalid metadata, complete
plaintext review, keyboard activation, exact-version approval, original-daemon
retirement, app restart, changed bytes and Disable. Read-only fixture SQL checks
assert zero runs, zero model calls, one disabled revision-2 grant and two decisions.
It preserves fixture source/configuration files. This is management evidence,
not proof that an agent selected or loaded a skill.

E2E artifacts:
`.probe-skill-foundation-resume-e2e-1/skill-foundation.e2e.ts-Sk-b834d-d-disables-changed-versions/`.
Main inspected all six `skills-review-*.png` captures and retained `trace.zip`.
The separate `live-initial.png` captured an about:blank target during a late
agent-browser attachment; it is not acceptance evidence. The named browser
connection was closed and no owned Electron process remained.

Final changed-source/test/config identity: HEAD
`c5d02494f65abd3709ecd8c559b8fb5dfde43d4b`, plus the 278 input files enumerated in
`.probe-skill-foundation-resume-final-inputs.log`; SHA-256
`9f2e87252e5a768d8b2e7af278e7ebfeae68a3cc36586acc77a2f4bcdd8f44be`.
Their latest edit predates the successful full check. This identifies source
inputs, not an installer or published artifact.
Main rehashed all 278 inputs after the Electron run: the manifest matched and
the changed-file list was empty. Final `git diff --check` was clean.

Astra / Linnaeus independently reconciled the final report with the raw logs,
artifact inventory and bounded assertion corrections: VERIFIED WITH CAVEATS,
with no contradiction in outcomes or acceptance limits. This was an evidence
review, not a second execution. Environment scoping, user-data hashes and process
cleanup remain main-observed evidence. All continuation workers are closed.

## Remaining Boundaries

- S2 selection/loading, immutable used context and compaction/revocation design
  remain separately unapproved; S1 grants no tool permission.
- Native Linux/WSL2, live Turkish/native screen-reader acceptance and default
  cold parallel check stability remain OPEN.
- Installed EXE, packaging, signing, public update and release gates are not
  validated by this source delivery. No commit, push or publication occurred.
- The existing bundle warning about `@mete/cli/package.json` externalization
  remains. Broader sidebar/status-bar clipping is not closed by Skills captures.
- Impeccable reported a surface-path metadata warning although its source file
  exists. No global/project design metadata repair was undertaken.
