# Required Verification And Durable Evidence

Date: 2026-11-08, Europe/Istanbul.
Baseline: `c5d02494f65abd3709ecd8c559b8fb5dfde43d4b` plus the existing dirty
working tree. Scope: the approved ADR-187 G batch, not release acceptance.

## Status

The approved G batch is verified on the Windows source build. All reported
source-review findings were corrected; the final mandatory check, production
bundle and combined Electron scenario exited 0. This is not installed-package
or release acceptance. The previous U3-U5 counts are not reused here.

The user approved required checks stopping submission when they cannot run,
only explicit optional gaps permitting progression, and strict semantics for
all new runs while saved unmarked runs remain legacy.

## Ownership

The Astra lead owns contracts, shared resources/docs, contract kits, template
migration, composition integration and final validation. Sol workers own core,
CLI and UI implementation; Astra performs independent source review. No
automatic hook execution is assumed. The implementation ledger is
`docs/superpowers/plans/2026-11-08-verification-gates-implementation.md`.

## Source Review

| Finding | Source disposition | Runtime acceptance |
| --- | --- | --- |
| Exact protocol method and event maps/counts omitted new entries | Exact protocol34/45-method/50-event assertions retained; source-closed | Contracts passed |
| Verification contract kit could select historical rather than current evidence | Schema, strict mode and currentAttemptId asserted; source-closed | Core contract tests passed |
| CLI history discarded diagnostics/identity | Full verify.* JSON retained; source-closed | CLI passed |
| Duplicate command removal could remove both copies | Exact YAML-node edits preserve the other copy, flags and comments; source-closed | UI tests passed |
| Attempt/lifecycle changes could leave stale evidence | Identity-scoped refresh and generation rejection; source-closed | UI tests passed |
| Unknown metadata or disposal could start team reads | Positive team identity, retired selection and post-await checks; source-closed | UI tests passed |
| Closed disclosures hid current gaps | Current-only summary, explicitly stale during failed/loading reads; source-closed | UI tests and Electron passed |
| Legacy/interrupted/empty text overstated evidence | Separate legacy, uncertain, missing-record and zero-gate text; source-closed | UI tests passed |
| Capability-form shell checks bypassed validation | Both forms validate full shell output; every supported catalog ref has output validation; source-closed | Core passed |
| Initialization/best-of-N could overwrite newer snapshots | Ownership checked after masking, before admission and after each judge candidate read; source-closed | Core passed |
| Invalidated finished proof could reappear as current | Current attempt never falls back to its cleared finished copy; source-closed | Core passed |
| Reader preferred stale held memory | Guarded persisted reads, including failure/removal; source-closed | Core passed |
| Read refusal could leave active calls dispatching | Token/model fencing plus sequential and parallel pre-dispatch guards; source-closed | Six fault-injection cases passed |
| Completed-run label had insufficient light-theme contrast | Uses the existing theme ink without changing the success wash | Final Electron axe checks passed |

Independent review was source-only. The runtime column refers to the lead's
subsequent executions, not to an independent reviewer rerunning the suite.

## Final Validation

All tests/builds and IDE launches were deferred until the development/source
review pass ended. Failures discovered in this final stage were fixed and
rechecked without disabling assertions, rules or mandatory checks.

| Command/evidence | Actual result |
| --- | --- |
| `pnpm check`, `.probe-verification-check-8.log` | Exit 0; Biome 1379 files; TypeScript passed; 1591 modules/5897 dependencies without violations; 63 script tests; `34 successful, 34 total`, 31 cached |
| Core tests within the final check | 666/666 passed, 100 files |
| UI tests within the final check | 951/951 passed, 132 files |
| CLI tests within the final check | 220/220 passed, 64 files |
| Contracts within the final check | 277/277 passed, 42 files |
| `pnpm --filter @mete/desktop bundle`, `.probe-verification-bundle-2.log` | Exit 0; browser/Node/Electron builds had zero errors; existing CLI package externalization warning remains |
| Combined Electron, `.probe-verification-e2e-final.log` | Exit 0; 1/1 passed in 34.6s, retries 0 |
| `git diff --check` | Exit 0 |

Electron exercised required missing-capability blocking, explicit optional
nonexecution beside an actual pass, executed failure, keyboard disclosure and
refresh focus, and one deliberate app/daemon restart. All three evaluation IDs
remained identical after restart. Light, Dark and High Contrast were checked
at 1366x900 and 700x900. All six captures were visually inspected; verification
layout bounds and serious/critical axe checks passed. Artifacts and trace:
`.probe-verification-e2e-final/`.

All model responses were scripted and all application profiles/workspaces
isolated. This does not certify real-provider quality, native screen-reader
acceptance, Turkish interactive acceptance, or the whole app's narrow layout.

## Failed Checks Retained

- Check attempts 1-4 exposed lint limits, test typing, a type dependency cycle
  and two stale protocol expectations. These were corrected, not bypassed.
- The first focused core run had 12 failures: partial store fakes, two-gate
  array expectations and a corrupted-ended-row shutdown read. Subsequent
  shutdown/read-refusal regressions were fixed without increasing timeouts.
- The parallel read-refusal regression genuinely failed first: one MCP listing
  occurred when zero was required. The exact return guard made all six driver
  fault-injection cases pass. Red/green logs are
  `.probe-verification-parallel-read-{red,green}.log`.
- Check 5 had a parallel metadata test timing failure; its unchanged file passed
  five consecutive focused runs, then passed in check 6 and the final check.
  Check 6 had a real-Git concurrency timeout followed by an EBUSY cleanup error.
  No affected Git process remained. Check 7 passed 34/34 without source/timeout
  changes; check 8 subsequently passed after the contrast fix. These earlier
  failures remain in their logs; no broader flake-free claim is made.
- The first Electron attempt passed the functional/restart assertions, then
  failed axe: completed-run text contrast was 3.25 versus required 4.5. The
  final CSS correction was followed by check 8, a new bundle and the passing
  final Electron attempt. No axe rule or scope was relaxed.
- Two existing `@mete/tools` tests are explicitly non-Windows-only and skipped
  on Windows (`fs-context-path` and `fs-context-links`). Linux remains OPEN.

## Tested Source Identity

HEAD remains the baseline above. A sorted digest of 162 changed/new code,
configuration and test files in the full dirty checkout (including prior work,
not only G) is:
`1f01e9a5400118092b13e8aefc13614690fd4c304a6e78f3fb973015f6c56883`.
It hashes each relative path, NUL, file bytes, NUL; includes
ts/tsx/mjs/json/css/yaml/yml/patch files and excludes `.probe*` files.
Documentation-only closeout edits are outside this digest.

## User Data And Boundaries

Before and after final validation, the global files match the preserved baseline:

- `%APPDATA%/METE/mete.db` SHA-256:
  `56692C1F259A65088D38D28B23EA1DD7D2AF1CE0F3286D3F3F22C68347E4728F`
- `%APPDATA%/METE/settings.yaml` SHA-256:
  `52419E7913D64E774FDE27D9D4ACEA09FC1527B1BEB5B0374AF37A28D6B9B90E`

No user configuration migration, data reset, real-provider test, install,
publication, signing, public update download or Linux acceptance is included.
Release-security gates, sidebar clipping and separate skill/memory work remain
open. No feature-parity or product-completeness claim follows from this batch.
The final test app/processes and this run's workers are closed; unrelated tool
runtimes were left alone. No commit or push was performed.
