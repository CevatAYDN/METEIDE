# Skill Activation Development

Date: 2026-11-08, Europe/Istanbul.
Status: IN PROGRESS; no S2 runtime acceptance claimed.
Baseline: `c5d02494f65abd3709ecd8c559b8fb5dfde43d4b` plus existing dirty work.
Chat: `01a1bc34-f67a-7852-9f3a-2a3af09710a4`.

The user requested the next work after receiving the written S2 specification,
accepting [ADR-190](../adr/190-skill-runtime-activation-and-provenance.md) and
the [package plan](../superpowers/plans/2026-11-08-skill-activation-implementation.md).
The [design review](2026-11-08-skill-activation-design.md) remains historical
design evidence, not proof that the new runtime works.

## Sequencing And Ownership

Tests are authored before their corresponding implementation, but no tests,
typechecks, builds or IDE launches run until the complete development batch
and source review finish. Main Astra owns integration/docs/final validation;
native `lead_code` Sol workers own bounded code slices and native `lead_review`
Astra reviews trust, concurrency, public contracts and changed assertions.
Existing dirty work, user settings/data and release boundaries are preserved.

## Current Work

| Slice | Owner | Status | Evidence |
| --- | --- | --- | --- |
| P0-C | Sol / Sagan | implemented; main source-inspected | 130 reported changed lines; exact registered engine/quiesce callback before recovery, fresh activation identities; tests authored, NOT RUN |
| P0-T1 | Sol / Sagan | implemented; main source-inspected | Latest native pair only, checked before and after drain; 242 reported changed lines; tests NOT RUN |
| P0-T2 | Main | authored | Native drain regression now starts the real core with a scripted provider, holds an actual fs read and pauses before management; no fake quiesce success |
| C1a | Sol / Raman | implemented; main source-inspected | Owner/version/policy/snapshot and per-context schemas; eight authored groups, NOT RUN |
| C1b.1 | Sol / Raman | implemented; main source-inspected | Runtime-specific error and complete catalog schemas; 243 reported added lines; S1 unchanged; tests NOT RUN |
| C1b.2a | Sol / Raman | implemented; main source-inspected | Strict complete inventory, owner and count invariants; 249 added lines; tests NOT RUN |
| C1b.2b | Main | implemented; source review complete | Runtime port/result envelopes and run-wide checking schemas; authored tests, NOT RUN |
| Exports | Main | implemented | Primitive, catalog, receipt and port contracts use the existing skill barrel |
| Early review | Astra / Ramanujan | source review complete | No finding in completed P0-C/C1a; no test proof; reviewer closed |
| C1-ID | Sol / Sagan | implemented; main source-inspected | Exact fixed-order payload and code-unit sorted metadata keys; 245 added lines; tests NOT RUN |
| R2 | Astra / Ramanujan | source review complete | No actionable finding in CLI native admission/drain or catalog contracts; execution remains OPEN |
| R3 | Astra / Ramanujan | source review complete with finding | Lossy special metadata key and missing pre-admission sizing route; see open decisions |
| C1-R3 | Sol / Sagan | implemented; source finding closed | Independent recheck found no remaining lossless-map issue; 197 changed lines; tests NOT RUN |
| C2a | Sol / Raman | implemented; main source-inspected | New conversation.thread@3 inputs; 242 lines, @1/@2 unchanged; tests NOT RUN |
| C2b.1 | Sol / Raman | implemented; main source-inspected | Exact role selections and new-start inputs; 211 added lines; tests NOT RUN |
| A1 | Sol / Sagan | implemented; main source-inspected | Global append-only receipt store and real-SQLite tests; 300 added lines; NOT RUN |
| C3b | Main | implemented; source review complete | Content-free event schema and docs/07 row together; refusal tests authored, NOT RUN |
| R4 | Astra / Ramanujan | findings recorded | Indexed-run omission, shared nested defaults and stale event-count assertion |
| A1-R4 | Sol / Sagan | implemented; source finding closed | Global binding validation before indexed lookup; 171 changed lines; original-run regressions NOT RUN |
| C2/C3-R4 | Main | implemented; source findings closed | Independent recheck closed fresh-default and precise event-count findings; tests NOT RUN |

C1a reported 334 added lines including 233 test lines, 34 over the approximate
300-line target. This overage is recorded, not hidden by deleting assertions.
Following slices are subdivided in advance and target at most 250 manual lines.

The native-drain regression retains expiry, cancellation and post-drain authority
refusals. It now observes the actual native gate, requires the operation to remain
pending while a real core tool is in flight, and asserts one scripted provider
request, a still-paused run and no network fetch. Replacement cases change the
selected implementation; descriptor replacements remain covered by admission
unit tests. No case has been executed in this stage.

## Source Findings And Decision

- R3-P2: installed Zod 4.6.7's record parser skips an own `__proto__` key.
  The direct canonical encoder preserves it, but the shared metadata schema can
  discard it before hashing. Main confirmed the source path and documented
  string-to-string map contract. A bounded lossless-parser correction now
  preserves every supported key, including its value validation and pair count.
  It keeps previous issue classifications and adds schema-to-canonical
  regressions. Independent recheck closed the source finding; executable
  validation is NOT RUN.
- R4-P1: corrupting the indexed `run_id` could make the original run's inventory
  look empty before its receipt JSON was checked. The initial corruption fixture
  queried only the changed ID. The correction validates global row/JSON/index
  correspondence before indexed lookup, without filtering by workspace.
  Original/new-ID refusal, hidden malformed records and healthy cross-workspace
  isolation regressions were added. Independent recheck closed this source
  finding; no detection claim is made for a fully consistent malicious rewrite
  of the protected global authority database. The O(global receipt count) scan
  cost is explicit and has not been performance-tested.
- R4-P2: object-literal Zod defaults shallow-copy their outer object, sharing the
  nested selected/roles arrays. Main changed both new start defaults to factories
  and authored mutation-isolation regressions. The new event's precise catalog
  assertion is now 51, retaining the documentation/schema equivalence check.
  Independent recheck closed these source findings; no executable check has run.
- R3-D1: the accepted runtime port lacks a receipt-free path to validate an
  explicit set's full masked aggregate before run creation. Two valid 40 KiB
  snapshots already exceed the 65,536-byte context limit; the catalog exposes
  neither bodies nor sizes, `load` issues a receipt only after the run is saved,
  and `check` checks issued snapshots. This remains a gap even with a ready
  catalog, not only on catalog overflow. Main and the independent reviewer
  found no route in the accepted specification or FAQ.
- Owner approved the separate read-only `skill.selection@1.check` on November 9
  with "evet gerekli her seyi deneyebilirsin". ADR-191 records exact versions and
  aggregate validation with no run, receipt, S1 preview or reusable authority.
  The contract is implemented; native integration is in progress. Existing
  permissions, provider/model roles and end-only test sequencing are unchanged.

## Verification

`pnpm check`: NOT RUN.
Focused suites, contract kits, chaos, desktop bundle and Electron: NOT RUN.
No real provider, user profile, install, commit, push or release operation.
S1's earlier passing counts are not reused as S2 evidence.
The narrow `skill-native-integrity` Changeset covers native admission and
metadata fidelity only; it does not announce a completed S2 runtime.
Native Sol sessions were resumed after preflight approval; current work is
listed below. The complete S2 development gate remains open, so tests have not
started under the user's end-only sequencing request.

## Worker Availability

At 23:50 +03:00 on November 8, the new native Sol C1-ID worker failed with
`model_not_supported`. Its two owned files were absent at that checkpoint; the failed worker was
closed. Earlier successful P0-C/C1a deliveries are retained. The already-started
CLI/catalog workers subsequently delivered their assigned slices. Their existing
Sol sessions delivered receipts, canonical identity, versioned inputs and the
bounded corrections; no other model/provider was substituted and the failed
session was not retried. Implementation continued on November 9. These delivered
slices have source review only; native runtime integration and executable
validation remain unfinished; the owner decision is now accepted as ADR-191.

## November 9 Continuation

| Slice | Owner | Status | Evidence |
| --- | --- | --- | --- |
| C1-S | Main | implemented | Strict receipt-free selection input/result; tests authored first, NOT RUN |
| C2b.2a | Sol / Raman | implemented; main source-inspected | Metadata/context evidence, exact policy origins; 299 added lines; NOT RUN |
| C2b.2b | Main | implemented | Run-level metadata/detail read contracts and snapshot correspondence; NOT RUN |
| C3a | Sol / Raman | running | Strict session-bound protocol36 routes; old inputs unchanged |
| A2a | Sol / Sagan | implemented; main source-inspected | Exact native trust/masker/runtime readers; 294 added lines; NOT RUN |
| A2b | Sol / Sagan | running | Bounded complete eligible runtime catalog |
| E1 | Main | implemented | Durable run skill state kept outside messages; real SQLite reopen tests authored, NOT RUN |

Competitive ambition is tracked as measurable acceptance, not an assertion that
METE already exceeds every product. The current delivery remains Phase 5 S2;
publication, purchases, account changes and unrelated unwritten interfaces are
not implied by permission to try necessary development approaches.
