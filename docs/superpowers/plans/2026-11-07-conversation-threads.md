# C1-C3 implementation ledger

Status: User-approved design and continuation, 2026-11-07; verified in the recorded Windows source/unit/Electron scope.
Decision: ADR-182. Baseline: ac410907 plus the preserved ADR-180/181 dirty tree.
No commit, push, dependency install, external provider call or Phase 6 work.
The unrelated router-connections plan remains untouched.

## Bounded slices

Each numbered row was estimated as one package/concern, approximately 300 changed
lines including tests. Actual size overruns are recorded in the verification report.
A worker handles its rows sequentially; shared-file ownership stays with
that worker. Lead owns all tests/builds and the Electron process.

| ID | Owner | Package / files | Depends on | Acceptance | State |
| --- | --- | --- | --- | --- | --- |
| C1-A | Lead | contracts thread mutations + schema tests | ADR-182 | exact identity and unknown-field rejection | verified; contracts 256 |
| C1-B | Lead | contracts thread reads + protocol/barrel | C1-A | paging, summary/run shapes, legacy unchanged | verified |
| C2-A | Sol core | core thread tables/store + persistence tests | C1 | old DB, membership, ordered reads | verified |
| C2-B | Sol core + Lead | core atomic first-save integration + tests | C2-A | no orphan run/receipt, no work before commit | verified; preparation races corrected |
| C2-C | Sol core | core start/reply identity + tests | C2-B | duplicate, stale and competing sends | verified |
| C2-D | Sol core + Lead | core read/search/recovery/removal + tests | C2-C | masked search, paging, no resurrection | verified; fresh SQLite crash images |
| C2-E | Sol core | core module/quiescence + compatibility tests | C2-D | real composition, old ports unchanged | verified; core 498 |
| C3-A | Sol UI | ui-theia typed RPC/host bridge + tests | C1 | boundary schemas and failures | verified |
| C3-B | Sol UI + Lead | ui-theia thread/send state + tests | C3-A | stable intent id, stale navigation, retries | verified; actual retry-button callback |
| C3-C | Sol UI | ui-theia conversation list/search + tests | C3-B | one row, paging, team preservation | verified |
| C3-D | Sol UI + Lead | ui-theia composer/history integration + tests | C3-C | latest turn, history, errors, translations | verified; UI 722 |
| C3-E | Lead | CLI daemon dispatch + tests | C1 | validated new routes, masked errors | verified; CLI 183 |
| C3-F | Lead | desktop offline acceptance | C2/C3 | actual two-turn/restart/search/history flow | verified; final 2-test batch passed, six captures inspected |
| V | Lead + Astra reviewer | integration and docs | all | pnpm check, offline Electron, bounded review | check 34/34 passed; reported findings closed |

## Order and evidence

Lead first writes the contract boundary. Sol core and Sol UI then own disjoint
packages while the lead implements the CLI bridge. Tests are authored with each
slice, then run in coherent implementation groups, serially on Windows.
Only failing paths repeat during correction. Final `pnpm check` uses
`TURBO_CONCURRENCY=1`, without disabling any check.

An independent Astra reviewer inspects atomicity, identity, migration, deletion,
privacy and changed assertions. Source/unit evidence is recorded separately from
Electron and release acceptance. Until those checks finish, all work is at most
implemented, never verified.

## Evidence progression

Completed contract group: 41 tests; core/thread/legacy group: 43; composed
daemon group: 5; UI group: 80. Independent review then found the recorded
admission/read/retry races. Their bounded regression groups passed before the
final integrated check. Fresh-connection queued SQLite images passed both
post-commit and held-read recovery cases. Electron passed actual process restart,
search and individual-turn navigation after explicitly opening the restored
hidden Home sidebar.

Final `pnpm check`: exit 0, 34 successful / 34 total, 27 cached, 57.138 seconds.
Complete evidence, size-estimate misses and platform limits:
`../../reviews/2026-11-07-conversation-threads.md`.
