# Version-Bound Skill Activation

Date: 2026-11-08, Europe/Istanbul.
Status: accepted for implementation; development in progress, tests not run.
Owner: main lead, chat `01a1bc34-f67a-7852-9f3a-2a3af09710a4`.
Baseline: `c5d02494f65abd3709ecd8c559b8fb5dfde43d4b` plus existing dirty work.
Predecessor: [S1 foundation](2026-11-08-skill-runtime-design.md), ADR-189.
Decision: [ADR-190](../../adr/190-skill-runtime-activation-and-provenance.md).

The November 9 pre-admission gap is resolved by user-approved
[ADR-191](../../adr/191-receipt-free-skill-selection-validation.md): a separate
receipt-free selection check supplements the runtime ports without relaxing
the admission guarantee or changing S1.

## Approval And Scope

The user approved the presented S2 scope and revocation behavior with
"evet devam et": explicit and description-driven selection share one safe
loader, actual content survives compaction/restart, tasks retain separate
identities, and revoked instructions cannot resume model or tool work.
The user then requested the next work after receiving this written design,
approving its interfaces, operational defaults and implementation sequence.
Approval is not evidence of working software; final validation remains pending.

S2 covers native single-agent conversations and ordinary team task attempts.
It does not add a marketplace, installation, script execution, resource-bundle
approval, personal vault, code graph, external engine, dependency, telemetry,
account operation, commit, package or release. S1 management remains unchanged.
Tests are authored before code but executed only after the approved development
batch and source review. No real model provider or user profile is used in tests.

## Existing Constraints

- `skill.trust@1` is management, not a loader. Its global grant authenticates
  exact raw bytes and source/workspace identity, not a caller's masked snapshot.
- `domain/compact.ts` preserves two opening messages, cuts old tool results and
  summarizes middle turns. Ordinary message persistence cannot pin a skill.
- `application/reply.ts` carries saved messages into a new immutable run.
  Copying history must not renew skill authority.
- Editor snapshots are untrusted data under ADR-183. They are not skill inputs.
- S1 mutation admission refuses running/queued work and pending starts/resumes,
  drains paused loops, then retires the exact daemon. No new unlock is invented.
- Recovery rearms quota/network timers. Manual resume alone is not the gate.
- Native task workers own captured execution identities; late async results
  cannot mutate a different task, attempt, run or replacement drive.

## Selection And Compatibility

New S2 entries persist `skillRuntimeVersion: 1` and a policy
`{ mode: "off" | "manual" | "auto", selected: SkillVersion[] }`.
Default: `auto` with no explicit selections. `off` requires an empty selection.
`manual` loads only the explicit selections. `auto` loads explicit selections
first and lets the ordinary task model request other eligible versions.

`SkillVersion` is `{ sourceId, sha256, revision }`, using the opaque S1 source
identity, exact raw-byte digest and positive current grant revision. No path,
body, caller-selected root, permission or trusted-hash declaration is accepted.
Selections are ordered, distinct by source and limited as Budgets specifies.
Same-name workspace/global skills remain separate; no implicit shadowing.

A fresh explicit selection is revalidated. It never silently selects another
revision or same-name source. A missing, changed, disabled, ignored or invalid
source is a refusal, not an omitted selection. Updating a stale draft is explicit.

Automatic selection exposes only masked metadata of currently eligible versions.
The model chooses from descriptions inside its ordinary task call and invokes
`skill.load@1`; there is no classifier call or keyword-match guarantee.
Only the exact versions offered to that conversation may be requested.
An incomplete/oversized catalog is unavailable, never a partial list labeled
complete. Auto mode may continue without automatic selection with a visible gap;
it cannot discard an explicit selection or an already loaded skill.

Absence of the workspace S2 marker alone does not establish legacy status.
Before continuation, security independently looks up issued owners/receipts by
run identity, then checks the canonical workspace binding. An existing receipt
for another workspace is a refusal, not an empty inventory. A receipt-bearing
run cannot downgrade to legacy by deleting its marker or snapshots. Old runs
with neither marker nor authoritative receipts retain legacy behavior.
Existing capability/daemon shapes remain unchanged. The desktop and new CLI
starts use new ports; no legacy fallback strips selections. Shared continuation
guards apply regardless of the existing control path used to request resume.

Each conversational reply is a new run. Omission of its S2 policy inherits only
the predecessor's mode, not its loaded bodies or explicit selection authority.
The UI may carry exact selections as visible draft choices, but must submit
them explicitly for fresh validation. Receipt replay returns the same saved
run without scanning, loading, creating a new receipt or dispatching work.

## Runtime Ports

All external inputs, outputs, stored records and result envelopes are strict
Zod schemas in `@mete/contracts`. Expected failures return `Result`.
S1 source/catalog/trust interfaces and daemon protocol 35 methods are unchanged.

| Port | Owner | Proposed interface |
| --- | --- | --- |
| `skill.runtime@1` | essential security module, skill execution still optional | `inventory({ runId }, signal)`; `catalog(signal)`; `load({ owner, operationId, version, origin }, signal)`; `check({ runId, snapshots }, signal)` |
| `skill.selection@1` | essential security module | `check({ selected: SkillVersion[] }, signal)` returns `Result<null, SkillRuntimeError>` before admission; no bodies, receipt or reusable authority |
| `skill.load@1` | native core-engine | Model-facing `run({ sourceId, sha256, revision }, ToolContext)`; exact pending call and owner are derived by core, never model arguments |
| `conversation.thread@3` | core-engine | Existing @2 list/read/prepare/context plus versioned start/reply accepting the single-agent S2 policy |
| `run.skills@1` | core-engine | `start(RunStart plus skills)` for native single/team work; `read({ runId, contextId? })` for metadata summary or one retained context detail |

Security already requires storage; the receipt inventory is available without
the optional source/catalog/trust modules. Registering the port performs no
discovery or model call and adds no essential module dependency. Runtime load
and eligibility resolve native `skill.trust@1`, source and catalog through the
registry; they never read another module's grant tables directly.
`inventory` reads the complete run receipt membership from security-owned global
storage without skill-file reads. Unavailable/corrupt inventory is not empty.
This keeps genuine legacy/no-skill work independent of optional skill sources.

Before creating a run, core checks each explicit set through `skill.selection@1`.
It validates full current native evidence, exact versions and the combined
masked UTF-8 body budget independently of the model-catalog size. Empty sets
need no optional skill sources. It creates no review preview or durable state.
The loader revalidates after admission; a successful preflight is not a grant
or a cross-database reservation. Native final load admission also checks the
candidate's actual masked byte count against the exact retained context before
security issues a receipt, so an ordinary budget refusal cannot orphan one.

`catalog` returns eligible descriptors containing the version, masked source
label, name and full description. An explicit availability discriminator and
safe diagnostics distinguish ready-empty from unavailable. It never returns
unapproved metadata to a model or creates review previews.

`load` returns a masked `SkillSnapshot` only after a global receipt is durable.
Composition supplies a private native-load admission check: the exact input
object must belong to a live core-owned explicit/model operation. JSON owner
fields or an `origin` string cannot authorize issuance. Check that authority
across awaits and before commit; it is not a public flag or generic lease API.
`check` first requires complete receipt membership and payload integrity, then
validates current eligibility without replacing content. Both require native
composition-attested source/catalog/trust/runtime implementations and the
currently captured masker. A matching adapter
name or trust label alone is insufficient. Core resolves through the registry,
not security imports; missing/replaced/invalid adapters fail closed.

Runtime failures reuse applicable S1 codes and add `revoked`, `integrity_failed`
and `budget_exceeded`. Safe structured fields identify the affected source;
no raw exception, file body or secret appears in an error.
The inventory result is `{ runId, receipts }`; catalog and load return their
complete catalog/snapshot values, and a successful check returns no new value.
Each operation uses a strict `Result` envelope. Checking accepts all retained
contexts of a run, enforcing the body/count budget separately for each context,
not imposing a four-snapshot limit on a whole team run.
Existing engine ports map refusal to their existing `failed`, `bad_input` or
`not_supported` envelope, while `run.skills@1.read` gives the precise block.

`skill.load@1` is an engine-owned context operation, not a filesystem permission.
Its catalog schema lives with other model tools. Core offers its exact native
adapter only to an S2 ordinary working conversation with an available catalog.
The loader rejects calls without an exact live pending call, captured drive
identity and owning context. Native core privately admits the exact ToolContext
object for that dispatch; matching caller-supplied run/agent strings is not enough.
This is process-local authority, not a new serialized ToolContext trust flag.
The loader is not available to external MCP clients,
verification gates, routers, summarizers, reviewers, judges or lesson writers.
Its model result contains receipt/version metadata only, never the full body.
That acknowledgement is `{ receiptId, version, origin, loadedAt }`.
It is serialized as a context mutation, not classified as a parallel query.

## Snapshot And Receipt

Core creates a durable `contextId` before first load. The owner is
`{ runId, contextId, taskId?, attemptId? }`, with UUIDs generated by native core.
An ordinary task attempt has its own identity even when its role matches another
task. A model fallback retains the context; a new attempt gets another context.

A snapshot contains `receiptId`, owner, source/version identity, grant revision,
masked source label and metadata, complete masked SKILL.md text, `loadedAt`,
selection origin (`explicit` or `model`) and its canonical payload SHA-256.
The complete canonical payload, not just text, is integrity protected.
Its serializer has a fixed field order; the digest never includes itself.

Security owns a new global receipt table in its essential module's storage scope.
It stores immutable receipt identity, canonical workspace key, owner,
operation ID, exact grant revision, raw source digest and payload digest.
It stores no raw or masked skill body. A workspace snapshot's self-declared
digest, a copied workspace database or a caller's receipt ID is not a grant.
`check` recomputes the payload digest and matches every binding against that
global receipt, the current workspace and the current enabled grant. It starts
from the independently read complete inventory, not the supplied snapshot list.
Missing/rebound owners and omitted receipts fail closed. All receipts of an
unfinished run remain execution dependencies, including earlier task attempts;
history does not authorize another context, and hiding it cannot bypass revoke.

Repeated exact loads reuse the durably retained core snapshot only after current
authority and global receipt validation, preserving receipt, origin and loadedAt.
Reusing an operation ID with different intent is stale. A receipt whose full
snapshot was not durably retained returns `integrity_failed` and leaves the run
paused: never reconstruct, overwrite or silently issue a replacement. Thread
intent replay is separate and still starts no work. `(contextId, sourceId)` is
unique; a context cannot switch that source's version or count duplicate loads.
Native core derives origin from the explicit-selection coordinator or exact
pending model call, never a model argument; both use the same loading coordinator.

Load ordering: validate owner and offered version; capture native readers;
read full current inventory/source; validate metadata and exact bytes; mask;
recheck identity, cancellation, grant/revision and size; commit the receipt;
persist the full snapshot in the owning core state; only then acknowledge load.
The coordinator checks its captured drive/call/context after every await.
No storage failure becomes success or permits a model call with unrecorded text.
A receipt orphaned by cancellation or a failed core save grants no authority.

No cross-database atomic commit is claimed. Security's receipt and core's
snapshot are both required. Core commits a thread intent/run first, before
loading creates a receipt; a refused post-admission load leaves that exact run
paused with its block, and the caller receives its retained run identity.
Pre-admission invalid input/stale selections create no run. Changed intent
replay and stale conversation heads retain ADR-182 refusal semantics.

Receipts contain hashes/identities only and remain local audit evidence after
run removal, like S1 decisions. Removing a run deletes its masked snapshots
through existing run storage. No background scan, consolidation or new timer.

## Context And Policy

Store bodies separately from conversational messages. Build a request-only,
escaped `user` message after the system message and before the ordinary history.
It identifies the exact snapshots as user-approved workflow guidance, subordinate
to system rules and the current user's request. It cannot change role, model,
tool permissions, policy or verification requirements. Two conflicting skills
have no name-based priority; the task must ask for clarification when their
instructions cannot be reconciled with the user's request.

Only approved, persisted and currently checked snapshots enter this block.
The source-qualified catalog is separate bounded metadata. Delimiters in
metadata/body are escaped as data within the envelope, not executable markup.
The wrapper does not simultaneously declare loaded instructions forbidden and
ask the model to follow them. Authorization and action taint are different axes:
loading a skill taints its attempt and never clears previously retained taint.
Existing once/task/run permissions and protected paths continue unchanged.

Compaction operates on ordinary history only. Its size calculation also counts
the exact generated skill/catalog blocks, including labels and serialization.
They are neither aged tool output nor summary input. After compaction, reconstruct
them from the same authorized snapshots, never current file contents.
The gateway still enforces the actual candidate model's context limit.
After the existing one-fold retry, an oversized request follows the existing
`too_large` / `no_model` path; no skill or attachment is silently removed.

Supporting references, scripts and assets are not in the approved SKILL.md
version. They stay ordinary policy-governed files; a global skill does not widen
filesystem tools to global paths. S2 does not certify full resource execution.

## Revocation, Source Changes And Recovery

S1 Approve/Disable keeps its current idle admission and exact-session retirement.
A running/queued job is not silently cancelled to make management succeed.
The UI directs the user to pause it; only acknowledged mutation changes trust.
Before S2, correct the current provenance gap: composition must attest the exact
native engine/quiesce pair, not just continuity of whichever adapters resolve.
The paired objects are re-established after activation/restart and compared
before and after drain. An unattested/mismatched pair cannot admit management.

Before any S2 model call, ordinary tool call, verification dispatch, worktree/
merge continuation or automatic continuation, validate all issued run receipts
and retained snapshots. Also validate
before manual resume and before arming a recovered quota/network timer.
Asynchronous manual and internal timed resume checks share native admission;
a timer cannot bypass the pending-operation count while those checks await.
Read current grant/revision and current native source/ignore/root eligibility.
Missing/changed/ignored sources and a new enabled revision invalidate the old
context; re-reading is a check, never replacement of its saved content.

Failure keeps historical records intact, records a typed context block, clears
automatic resume timers and pauses the run with existing reason `user`.
No model/tool/verification request is dispatched. A team-wide pause applies if
any issued receipt is blocked; successful peers already in flight
may settle under existing drain rules, but no new work follows the refusal.
An already completed external operation is not claimed to have been undone.

Revocation is tied to the exact grant revision. Reapproving the same bytes at a
new revision does not silently revive a blocked context. Restart with a fresh
explicit selection/new run; no in-place replacement or authority override is
introduced in S2. A transient missing adapter may be retried by explicit Resume
only when the original source/version/revision and all receipts still validate.
Reads, cancellation and authenticated history remain available after revocation.
Missing/corrupt integrity evidence makes the detail read explicitly unavailable,
not empty; current source eligibility is not needed to inspect authentic history.

Recheck after core-owned preparation/waits, immediately before starting the
captured `llm.chat@2` iteration or invoking a native tool/verification adapter.
Gateway-internal discovery, masking, quota waits, retries and fallbacks stay
inside that already-dispatched call; S2 adds no per-provider-send callback.
Supported grant mutations remain excluded until paired native admission has
paused/drained work; cancellation uses the existing signal. External source/
ignore/root changes during an in-flight gateway call are detected at the next
core boundary, not guaranteed before every provider attempt. No unchecked result
survives a pause, replacement drive or adapter change. This is not an OS sandbox.

## Teams And Budgets

`run.skills@1.start` takes `skills: { mode, roles: [{ roleId, selected }] }`.
Role IDs are validated against the loaded template; a single agent uses its
existing `assistant` role. Duplicate/unknown roles or selections are refused.
An unspecified role gets the run mode and no explicit selection.
No team template receives a skill/tool/provider name or new field.
Explicit role selections require a concrete template or `templateId: null`;
an undecided router target with such selections is refused before its model call.

Each ordinary task attempt loads its role's explicit selections independently.
Auto mode offers the loader only during ordinary task work; when offered, the
seat requires existing `tool_calling` support without changing its model tier.
Review, clarification, judge, router, summary and lesson contexts receive no
skill bodies, catalog or loader. Task reports remain ordinary untrusted history,
not permission to import that task's skills into the next role.

These are accepted METE limits, not standard requirements or measured savings:

| Default | Value | Owner |
| --- | --- | --- |
| Eligible catalog entries | Existing S1 maximum 128 | contracts |
| Serialized model catalog, full masked descriptors | 16,384 UTF-8 bytes | contracts |
| Distinct selected/loaded skills per context | 4 | contracts |
| Complete masked skill text per snapshot | Existing S1 maximum 65,536 bytes | contracts |
| Combined complete masked skill text per context | 65,536 UTF-8 bytes | contracts |

The complete generated request still counts against the existing context model.
Metadata/wrappers also count; the byte limit is not a token-limit exemption.
Model-catalog serialization overflow disables automatic selection visibly,
not explicit loading. Incomplete S1 source inventory still refuses fresh loads.
An oversized explicit set refuses admission; a model load beyond the remaining
context allowance returns a typed refusal and keeps earlier snapshots unchanged.
No truncation, automatic eviction, per-skill model summary or new paid call.
Defaults live in the owning `src/defaults.ts` with this document as their source.

## Transport, UI And Evidence

Protocol 36 adds `mete/skills.runtime`, `mete/thread.skills.start`,
`mete/thread.skills.reply`, `mete/run.skills.start`, `mete/run.skills.read`.
The runtime catalog response names the daemon `sessionId`; fresh S2 sends
include and check that session before admission. Capability inputs do not
accept session identity as proof of skill authority. UI requests also capture
workspace and transport identity; late reads cannot alter another draft/run.

Use the existing compact composer with a mode menu and a keyboard-operable
source-qualified selection list. Team mode groups choices by existing role.
Review/approval remains in Settings, never in the agent tool list. EN/TR labels,
three themes, narrow/wide layouts and preserved failed-send drafts are required.

An authoritative run read distinguishes selected, loaded, blocked, legacy and
historical-only context. Loaded means a durable validated snapshot, not evidence
that a remote model received or followed it. Historical means a prior context,
not a renewed grant. No "used successfully" or compliance claim is inferred.
Masked source/version/text can be inspected without re-reading the disk version.
The default read returns metadata only; `contextId` requests that exact context's
bounded retained text. The UI requests it on expansion, never every body at once.
History integrity uses global inventory/digests, not current source availability.

The concrete read discriminant is `kind`: `legacy` contains only `runId`;
`summary` contains the run policy and context summaries; `context` contains one
summary and its complete bounded snapshots. Each summary identifies owner, role,
original policy, selected/loaded/blocked/history state, metadata-only loaded
receipts, optional typed block and optional catalog-availability notice.
Explicit-origin records must match their original ordered selection and
model-origin records require auto mode. A detail's metadata must exactly match
its snapshots. S2 summary/detail results may also retain a typed run-wide block,
including a refusal before a task context exists. No default summary contains
descriptions or instruction bodies.

Add one content-free `run.skills.updated` event with `{ contextId }`, using the
existing run/task/agent envelope. It tells views to refresh the authoritative
read after persisted load/block changes. Add its schema and docs/07 row together.
Bodies/descriptions never enter events, global logs or authored-message search.
The gateway's existing request record remains the evidence of request content.

## Acceptance And Delivery

The [implementation plan](../plans/2026-11-08-skill-activation-implementation.md)
splits contracts, security, core, transport and UI into single-package concerns.
Every coding slice includes tests and stays around 300 manual changed lines.
Main owns documents/integration; Sol owns bounded code; Astra independently
reviews authority, concurrency, versioning and changed assertions.

Acceptance must cover forged/cross-workspace receipts; stale grants and sources;
masked escaped metadata; cancellation and late callbacks; exact duplicate loads;
DB failure before/after receipt; no model dispatch before durable content;
compaction with aged tool results; new-turn authority; task/attempt separation;
manual/timed recovery; revocation between waits; optional-module absence; full
context-budget accounting; and truthful UI states with no real provider calls.

Execute focused unit/contract/composition tests and `pnpm check` only after
development and source review, then source-built Electron and accessibility.
Use isolated temporary data. Report raw exits and input identity. Preserve the
known default parallel-test timing gap; do not weaken waits/assertions to hide it.
Windows source evidence does not close WSL/Linux, installed-app or release gates.
