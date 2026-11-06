# Conversation-first desktop and release signing

Status: User approved the conversation-first direction on 2026-11-06; implementation proceeds in package-sized slices.

Implementation note (2026-11-07): contracts, core follow-up, daemon transport and
the two-turn desktop conversation are implemented. Each follow-up is still a
separate sidebar run with the original title; conversation grouping was not added.
Visual review still calls for a smaller run summary and better composer fit.
Signing enrollment, trusted signing CI and a real installed update remain pending.

## Experience

The normal single-agent surface is a conversation: user messages, assistant replies,
a persistent message composer, model selection, and a clear working/paused/error state.
Sending again after a reply keeps context; it is not another blank task form.
Team templates remain available through an explicit team choice. Diagnostics,
checkpoints and tool-call arguments are progressively disclosed instead of competing
with the conversation. Existing safety controls and approval prompts stay accessible.

## Execution and persistence

Completed runs stay immutable. A follow-up creates a new single-agent run from the
completed predecessor's persisted messages plus the new user message. The selected
model preference and external-content taint carry forward; old tool calls are history,
not replayed. Each new run keeps its own budget, checkpoints and agent identity.
The server accepts follow-ups only for completed single-agent runs in this workspace.
Empty messages, unknown runs, team runs and active/paused/failed/cancelled runs are
refused without starting work. A user must resume or address a paused run explicitly.

Use the narrow new capability `run.reply@1`, not a silent change to `team.engine@2`.
It accepts `{ runId, message }` and returns `{ runId }` for the newly created run.
Daemon protocol 28 adds `mete/run.reply` with the same validated request and result.
Existing `team.engine@2`, run terminal states and event schemas remain unchanged.
The single-agent view reads the existing masked transcript; it includes the original
goal as the opening user message and later user/assistant turns from that transcript.
It switches to the returned run after Send, preserving the visible conversation.
Model text, tool results and secrets never enter new event payloads.

## Slices (each tests first, then pnpm check)

1. `@mete/contracts`: reply capability input/output/adapter, daemon method and version,
   schema tests; update ADR/specification. No runtime behavior yet.
2. `@mete/core`: create a follow-up from the validated saved context; preserve taint
   and model choice; register `run.reply@1`; cover isolation, refusal and restart.
3. `@mete/cli`: resolve reply capability in daemon; validate requests and preserve
   errors/masking; offline composition tests.
4. `@mete/ui-theia`: daemon bridge and tested reply state; persistent composer and
   conversation rendering, preserve draft on errors and prevent double Send.
5. `@mete/ui-theia`: conversation-first entry and progressive disclosure, keeping
   teams, model controls and safety actions; English/Turkish; accessibility.
6. `@mete/desktop`: scripted two-user-message acceptance, restart/history, paused/error
   handling and keyboard checks; rebuild bundle and installer only after gates pass.

Each slice is limited to one package/concern and roughly 300 changed lines; split
view, controller, transport and tests further when needed. No new runtime dependency.
Do not claim the full feature is usable until the desktop acceptance passes.

## Signing and updates

No usable code-signing credential was found on the development machine. SignPath
Foundation's public terms require an OSS license, an existing release, documented
functionality, signing/privacy policies, MFA, named maintainers/approvers, manual
release approval and verifiable build origin. Admission is discretionary. A trusted
build system is required for their OSS signing. ADR-179 now permits an optional,
manually approved signed-release pipeline on GitHub-hosted Actions; normal local
checks and unsigned packaging must not depend on it. Alternative: a CA-issued code-signing certificate
with hardware/cloud-backed key custody, purchased and identity-validated by the owner.

First prepare truthful policy and release prerequisites; do not claim SignPath
sponsorship before acceptance. The owner submits legal/account information and
enables MFA. Never request private keys, passwords or token values in chat. Do not
install a self-signed root as a substitute for publicly trusted signing.

The current GitHub update feed has no published release. Actual update testing needs
two distinct packaged versions, a published newer installer plus its matching
`latest.yml`/blockmap, and explicit approval to publish. Verify executable and installer
signatures after signing, then compute hashes and publish; do not sign an already
published installer without regenerating updater metadata. Signature validity alone
does not guarantee that SmartScreen never warns.

Sources checked 2026-11-06:
- https://signpath.org/terms
- https://signpath.org/apply
- https://docs.signpath.io/trusted-build-systems
- https://docs.signpath.io/origin-verification
