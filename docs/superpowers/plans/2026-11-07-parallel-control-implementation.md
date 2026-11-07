# P2/P4/P5 implementation slices

Status: Approved on 2026-11-07 ("evet devam etsene"); implemented and verified in the recorded Windows scope.
Further S5-S8 implementation follows the now-approved bounded split in
`2026-11-07-parallel-control-bounded-slices.md`.
Date: 2026-11-07
Accepted decision: ADR-181. Parent plan: `2026-11-07-reference-ide-roadmap.md`.
The existing dirty tree and unrelated router-connections plan are preserved.

| Slice | Owner | Files/package | Dependency | Done evidence | Status |
| --- | --- | --- | --- | --- | --- |
| S1 | Lead | contracts: isolation schemas/tests | ADR-181 | strict schema and contract tests | focused checks passed |
| S2 | Sol contracts | contracts: policy requests and task controls/tests | ADR-181 | exact identity, strict answers, legacy unchanged | focused checks passed |
| S3 | Sol tools | tools: native fs confinement descriptor | S1 | real temp-root/escape/symlink tests | focused checks and correction review passed |
| S4 | Sol tools / Lead core | tools: native provenance; core-owned allocation order | ADR-181 | real Git refs/contents and replacement queue tests | verified; bounded review closed |
| S5 | Lead/Sol core | core: checked chain and isolated writer admission | S1/S3/S4 | two roots, exclusive fallback, pause/cancel/recovery | verified; core 474 passed |
| S6 | Sol security | security: exact requests/grants | S2 | cross-agent, args, stale, masking and taint regressions | 114 tests passed; reviewed |
| S7 | Lead/Sol core | core: persisted pending task identities | S2/S6 | recovery and duplicate/stale answer rejection | focused checks passed |
| S8 | Lead/Sol core | core: task-local waiting and active decisions | S5/S7 | two asks, independent work, review/clarify/merge/setup | verified; bounded review closed |
| S9 | Lead | contracts: events and protocol 30 | S2 | schemas, catalog rows and legacy protocol tests | focused checks passed |
| S10 | Sol CLI | CLI: daemon task control/legacy allow | S8/S9 | validated dispatch and ambiguous legacy refusal | 23 tests passed; port registered |
| S11 | Sol UI | ui-theia: task pending actions | S10 | stale UI, loading/error states, i18n | UI 701 passed; Electron task decisions passed |
| S12 | Lead/Astra reviewer | integration and docs | all | pnpm check, offline Electron, independent review | verified: 34/34 check tasks; 14 Electron scenarios |

Each package concern is implemented separately. A slice exceeding approximately
300 changed lines or touching multiple packages' public APIs must be split and
approved before dispatch. Tests are authored with each change, then run in coherent batches.
Only failing paths are repeated during correction. No real model calls.
No commit/push, installer/release claim or configuration grant is implied.

Historical test-first audit: lead-authored task-control runtime had preceded its
regressions. Only those new runtime files and their exact wiring were removed;
pre-existing work and worker edits were preserved. The already-authored domain
test then preceded the small task-wait schema implementation. That earlier state
is superseded by the implementation and focused checks recorded above. Final
evidence and remaining limits live in `../../reviews/2026-11-07-parallel-control.md`;
earlier green F/P checks are not evidence for these new changes.
