# Version-Approved Skill Runtime

Date: 2026-11-08, Europe/Istanbul.
Status: S1 implemented and verified on Windows source; S2 separately accepted in ADR-190.
Design owner: main lead, chat `01a1bb28-b67b-7962-96a6-df22b364a89c`.
Delivery continuation: main lead, chat `01a1bc34-f67a-7852-9f3a-2a3af09710a4`.
Baseline: `c5d02494f65abd3709ecd8c559b8fb5dfde43d4b` plus existing dirty work.

## Approval And Scope

The user approved content-version authorization followed by task-based selection:
metadata first, explicit review before eligibility, changed content needs new
approval, no permission grants or discovery-time execution, and immutable used
content. The subsequent "evet uygula" approves the S1 interfaces, defaults and
package sequence below. S2 remains outside this implementation approval.

Deliver this as two separately bounded stages:

1. S1: discover, inspect, approve and disable exact local skill versions.
   This is a usable management foundation, not a functioning agent skill loader.
2. S2: explicit/model-selected activation, immutable run provenance, context
   budgeting, compaction/recovery and team integration. Its contracts receive
   a separate design pass after S1; S1 exports no model-callable skill tool.

M1 is closed and outside this design/review scope. Personal vaults, code graph,
external engines, new registries, automatic installation, telemetry and release
work are excluded. No new runtime dependency is proposed.

## Current Integration Points

- `docs/10-tools-mcp-runtimes.md:234` defines workspace `.mete/skills/` and global
  `skills/`; `docs/08-orchestration-and-teams.md:218` includes matching skills.
- `SECURITY.md:73` keeps workspace skills agent-writable. Location alone cannot
  authorize instructions. Existing policy and protected-path rules remain.
- `packages/tools/src/module.ts` already receives workspace/global folders and
  owns confined native reads. Its package has no YAML dependency.
- `packages/mcp` already owns local registry parsing and depends on YAML/Zod.
  A separate skills-catalog module here need not connect any MCP server.
- `packages/security` already owns scoped storage and secret masking. A separate
  optional skill-trust module avoids adding catalog dependencies to essential
  security activation.
- Existing context snapshots are untrusted editor data, not skill authorization.
  Do not reuse `conversation.thread@2` attachments as a skill-loader shortcut.
- `packages/core/src/domain/compact.ts` preserves the first two messages, not
  arbitrary later instruction blocks. S2 needs dedicated retention/recovery
  tests; ordinary tool-result persistence alone is not skill-context support.

## S1 Discovery And Parsing

- Scan only direct child directories of the two specified roots for exact
  `SKILL.md`. No ancestor, `.agents`, `.claude`, registry or network discovery.
  S1 scans only on explicit user intent. Missing roots are empty; unreadable
  roots are explicit errors, not empty.
- Workspace enumeration/reads retain current `.meteignore` and file-tool
  eligibility. Global reads are confined to the app-owned global skills root;
  ordinary `fs.read@1` does not gain access to arbitrary global files.
- Refuse symbolic links/junctions within the skill tree, nonregular files,
  hardlinks, NTFS streams, traversal, binary/NUL data and invalid UTF-8.
  Anchor each root to its current canonical identity; root replacement cannot
  reuse approval. These checks are not an OS sandbox against arbitrary shell
  commands or concurrent external filesystem replacement.
- Hash exact file bytes with SHA-256, before masking or newline normalization.
  A UTF-8 BOM may be removed for parsing only and stays part of byte identity.
- Parse YAML with the existing parser in `@mete/mcp`, then Zod at the boundary.
  Reject malformed/unclosed/duplicate-key frontmatter and YAML aliases. Never
  repair malformed metadata into a different interpretation.
- Required fields: `name` and nonblank `description`. Initial names use lowercase
  ASCII letters/digits and single hyphens, at most 64 characters, no leading or
  trailing hyphen, matching the containing directory; Windows device names fail.
  Description is at most 1,024 characters. Body must be nonblank.
- Recognize optional `license`, `compatibility`, string-to-string `metadata`,
  and string `allowed-tools`. The last is displayed as unsupported permission
  metadata and never grants access. Compatibility is informational, not a
  command or environment probe. Unknown fields produce an unsupported-field
  diagnostic rather than silently enabling another client's semantics.
- Identity is source-qualified, not name-only: workspace and global copies
  remain separate entries. There is no implicit shadowing. Case/path aliases
  resolving to the same canonical source are diagnosed, not duplicated.
- Discovery shows valid and invalid states to the user. It sends nothing to a
  model. Invalid/ignored/missing sources cannot become eligible.

These are S1 budgets, not measured performance claims:

| Default | Value | Owning package |
| --- | --- | --- |
| Root directory entries examined | 256 per root | tools |
| SKILL.md bytes read | 65,536 | contracts; tools imports the shared bound |
| Frontmatter bytes | 8,192 | mcp |
| Valid metadata entries returned | 128 across both roots | contracts |
| Metadata key/value pairs | 32, each value at most 1,024 characters | contracts |
| Optional license/compatibility text | 500 characters each | contracts |
| Pending previews | 8 per workspace process | security |
| Preview lifetime | 5 minutes | security |

Public schema limits, including name/description lengths, have one definition
in contracts/defaults; adapters import them through the public package export.
Other defaults live in their owning package's `src/defaults.ts`, referencing
this specification. Exceeding a discovery limit returns an explicit incomplete/error
state and disables approval from that inventory; never report complete absence.
No file body is silently truncated into an approvable version.

## S1 Authorization And Lifecycle

1. User asks to review one source. The host resolves current native source and
   catalog adapters, validates the complete entry and masks metadata/body.
   A failed masker or invalid rebuilt preview fails closed.
2. Security creates an opaque, process-local preview ID retaining canonical
   workspace/source identities, raw file digest, masked-preview digest, current
   trust revision and the exact adapter objects used. The client cannot supply
   replacement contents or declare a digest trusted.
3. Explicit Approve consumes that preview. Re-read and re-parse the source,
   re-mask it, compare both digests/identities and recheck adapter ownership.
   Expired, replaced, cancelled or stale previews are refused without writes.
4. Persist the grant in a module-owned table in global `mete.db`, keyed by
   canonical workspace identity plus workspace UUID, canonical source identity
   and content digest. Global-source approval is still per workspace in S1.
   A repository-provided YAML file or copied workspace database is not a grant.
5. Keep one current enabled digest and monotonic revision per source/workspace.
   Approving another digest replaces eligibility, not historical evidence.
   Disabling records a tombstone/revision so old previews cannot re-enable it.
   Returning to previously approved bytes is the same content version only
   while its exact grant remains current and enabled.
6. Prepare/review never quiesces. For mutation, capture the originating daemon
   session/workspace, quiesce it, then revalidate expiry/source/adapters/revision
   and mutate in that same process. Do not call stop-before-mutation
   `restartIdle`: that would destroy the preview. Quiesce is irreversible, not
   a temporary lock. The module requires composition-owned admission, not a
   client `idle` flag. Global DB compare-and-update includes the audit atomically.
7. Record local approve/disable decisions without skill bodies or secrets.
   Failed storage/audit writes are failures, never successful authorization.
   Pending previews disappear on restart; persisted grants do not.

After confirmed quiesce admission, the host retires that exact captured daemon
on every completion path, including stale/expired/cancelled requests and failed
writes. Never close a replacement session or restart before mutation. Retirement
invalidates its previews; reconnect and refresh acknowledged state. An uncertain
admission/mutation response is a visible recovery state, not permission to replay
approval or terminate an unverified active session. A standalone CLI approval
must prepare, confirm and mutate within one lock-holding process, then exit.
Tests must cover expiry during drain, failure cleanup, same-folder replacement
and lost acknowledgements. Reuse management lifecycle patterns; no new core gate.

All grants are to load reviewed instructions, never to execute a script, install
a dependency, choose a provider or weaken an action policy. Management ports are
not model tools or MCP-exposed agent actions. S1 does not rewrite user skills,
`.mete/*.yaml`, `.meteignore`, templates or unrelated global settings.

## S1 Interfaces

All schemas live in `@mete/contracts`; expected errors are `Result`, external
input/output is Zod-validated, and every new capability starts at `@1`.
No existing capability input/output or daemon method is silently extended.
Shared failure codes are `bad_input`, `not_found`, `ignored`, `unavailable`,
`limit_exceeded`, `stale`, `expired`, `aborted`, `busy` and `storage_failed`.
Diagnostics carry safe source identifiers and validation locations, never raw
exceptions, unmasked text or arbitrary client-supplied filesystem paths.

| Capability | Owner | Narrow operations and invariant |
| --- | --- | --- |
| `skill.source@1` | tools | `list(signal)` and `read({sourceId}, signal)` over only the two roots; opaque source ID resolves server-side, never accepts a caller root. Read returns exact bounded text, digest and source identity. Not a model tool. |
| `skill.catalog@1` | mcp | `list(signal)` returns parsed metadata/diagnostics and inventory completeness; `inspect({sourceId}, signal)` returns validated source content. Reads source through the registry; no direct tools-module import. Not a model tool. |
| `skill.trust@1` | security | `status`, `prepare({sourceId})`, `approve({previewId})`, `disable({sourceId,expectedRevision})`; all cancellable operations take a signal. Only native composition may supply admission/source attestations. No generic arbitrary-hash grant. |

`catalog.inspect` validates only the requested source; it is not an approval.
Trust checks full current inventory before preparing and again after admission
before approving. Native lookup may retain bounded source-address hints only:
every read reconstructs current root/ignore/file identity and reads fresh bytes.
No cached eligibility, root/ignore closure, digest or content authorizes a load.

Shared states distinguish unapproved, approved, changed, disabled, missing,
invalid and unavailable. A failed read cannot become an approved/empty state.
Approved requires a complete current read, valid metadata and the exact enabled
grant. Missing/invalid/unavailable source state overrides an older grant.
The host derives state from both current inventory and the trust record.
If discovery exceeds its budget, status may return an explicitly incomplete
list of masked historical grants so the user can still revoke them. Such rows
are unavailable current sources, never approved evidence, and carry no current
digest. Review and approval still require a complete fresh inventory; Disable
uses only the acknowledged source/revision and authoritative admission.
Prepare returns the reviewable masked snapshot, source label, preview ID and
expiry. Approve/disable return acknowledged state and revision, never optimistic
UI success. Approval is not proof the skill is safe, effective or compatible.

The CLI/desktop protocol advances from 34 to 35 for S1 management methods:
`mete/skills.list`, `.prepare`, `.approve`, `.disable` under that namespace.
List/preview responses carry a daemon-instance `sessionId`; prepare/approve/
disable require that exact session, checked before admission. Trust mutations
return `{ admitted, result }`, retaining admitted=true for post-quiesce errors;
admitted=false cannot carry success. The host captures the exact transport
instance and retires only that instance after a confirmed admitted response.
They remain available without a ready model engine when source/trust modules
are active; mutations still require authoritative idle admission.
Legacy daemon clients cannot silently fall back to writing settings.
No new event is needed for S1: the user refreshes inventory and sees the
acknowledged mutation response; trust decisions have their own local audit.

## S1 User Workflow

Settings gains a compact Skills section using the existing navigation and
English/Turkish resources. It lists name, source, status and any diagnostics.
Review shows the masked complete SKILL.md and its exact-version scope.
Approve is a distinct command; opening or previewing a skill never approves it.
Disable is available only for an acknowledged grant; stale actions fail visibly.
Source changes show Changed, not silently Approved. No install or script button.
No automatic folder creation until the user's explicit folder-management action.
Native editor opening remains a user action, not an instruction privilege.

S1 displays approval state only, never a Used/Loaded badge or claim that a skill
ran. S2 will add truthful selected/loaded/not-used provenance.
No large landing screen, second settings framework or new marketplace.

## S2 Follow-Up

These S1 constraints now have a separately accepted S2 contract in
[Version-Bound Skill Activation](2026-11-08-skill-activation-design.md), ADR-190.
The S1 approval did not implicitly authorize S2; the user approved its later
written design separately. S2 implementation and final validation are in progress.

Only current approved descriptors may enter a model catalog, with bounded
metadata and an honest unavailable state. Description matching is model choice
within the ordinary task call, not a new paid classifier or keyword guarantee.
Explicit user selection binds the exact source/version, not a same-name alias.
Loading must revalidate approval and persist masked content before a later model
call can use it. It must not be labeled as forbidden external instructions and
then simultaneously treated as an authorized workflow; taint and instruction
priority are separate concerns and must preserve action-policy enforcement.
Each run/task retains the content actually used; resume/compaction never replaces
it with the current disk file. Grant revocation and pending/active-run admission
need exact S2 behavior before code. Supporting references/scripts/assets remain
ordinary policy-governed files, not implicitly approved instruction versions.
S1 therefore makes no complete Agent Skills resource-execution compatibility claim.

## Acceptance And Package-Sized Sequence

Write tests before their implementation; execute after each approved development
batch and source review. No real model providers, user credentials or user data.
Every row is one package/concern, about 300 changed lines maximum; subdivide
before exceeding it. Main owns shared docs and integration, Sol owns code.

| Task | Owner/files | Dependency | Acceptance | Status |
| --- | --- | --- | --- | --- |
| S-D | Main + Astra / Heisenberg; this spec and ADR | Approved trust principle | Focused review's P1 daemon-lifecycle gap corrected/rechecked; user approved S1 | verified as design |
| S-C1 | Sol / contracts source/catalog schemas and tests | Technical approval | Invalid paths, metadata, states, digests and limits rejected | Windows tests passed |
| S-L1 | Sol / tools native source enumeration and tests | S-C1 | Missing/unreadable/bounded roots; ignore, link, stream and canonical identity cases | Windows tests passed; Linux open |
| S-L2 | Sol / tools exact source reads and tests | S-L1 | UTF-8, BOM, binary, changed bytes and cancellation; no global fs broadening | Windows tests passed; Linux open |
| S-P1 | Sol / mcp parser/catalog and tests | S-L2 | Strict metadata, diagnostics, no silent shadowing or incomplete success | Windows tests passed |
| S-C2 | Sol / contracts trust/management schemas and tests | S-C1 types; integration after S-P1 | Version-bound previews, revisions and explicit failures | Windows tests passed |
| S-A1 | Sol / security global trust store and tests | S-C1 types; integration after S-C2 | Atomic grant/tombstone/audit, workspace separation and restart | Windows tests passed |
| S-A2 | Sol / security preview/admission and tests | S-A1 | Forged/stale/expired preview, changed bytes, masking failure, adapter change and race | Windows tests passed; source rechecked |
| S-T1 | Sol / cli composition and offline tests | S-A2 | Optional modules; no model/network calls; actual file mutations affect status | Windows tests and chaos passed |
| S-T2 | Sol / cli protocol management and tests | S-C2; integration after S-T1 | Protocol 35, same-process preview/admission/mutation, drain expiry and failure response | Windows tests passed |
| S-U1 | Sol / ui-theia Skills list/preview and tests | S-C2; integration after S-T2 | EN/TR states, no optimistic approval or automatic install | Windows tests/Electron passed; live Turkish open |
| S-U2 | Sol / ui-theia approval/disable lifecycle and tests | S-U1 | Exact-daemon retirement after admitted mutations, failure cleanup, no stale action or uncertain replay | Windows tests/Electron passed; source rechecked |
| S-V | Main + Astra review / integration evidence | S-U2 | Focused suites, `pnpm check`, then isolated Electron flow and accessibility | verified for Windows source, with caveats |

Core activation, run persistence and compaction are deliberately not smuggled
into S1. After S1, approve the S2 contract/snapshot design separately.
Windows tests do not establish Linux path behavior; link/case/lock-sensitive
code also requires WSL2 checks. Installed-app and release acceptance stay open.
The [delivery evidence](../../reviews/2026-11-08-skill-foundation.md) records
the full uncached check with package concurrency 1, all actual failures/corrections,
chaos, source-built Electron and preserved user-data hashes. Default cold
parallel test timing remains an explicit open issue, not a waived check.

## Research And Review Boundary

The [Agent Skills specification](https://agentskills.io/specification), fetched
November 8, defines frontmatter and progressive loading. Its experimental tool
pre-approval field does not override METE policy. This is an independently
written design, not copied upstream code/prose or a compatibility certification.
The numerical operational budgets above are METE proposals, not standard limits.
S-D originally changed documents only. The later S1 delivery executed tests and
the source desktop build only after development; no commit or release followed.
