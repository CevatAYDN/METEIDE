# ADR-182: Persistent conversation identity over immutable runs

Status: Accepted
Date: 2026-11-07
Approval: The user approved the C1-C3 design and implementation with "devam et"
after the proposed stable identity, one sidebar row, history search, immutable runs,
idempotent sends, stale-head rejection and non-inferred legacy relationships.

## Context

ADR-178/180 create a new run for each conversational reply. The UI follows the
returned run, but no persisted relationship groups those runs after restart.
C1-C3 of the reference IDE roadmap address this without reopening completed runs.
C4-C5 attachments and the T/G/K decisions remain outside this approval.

## Decision

- Add `conversation.thread@1`; keep `conversation.run@1`, `run.reply@1`,
  `team.engine@2`, their message shapes and run terminal states unchanged.
- `start` accepts the conversation-start fields plus a UUID `requestId`;
  `reply` accepts UUID `conversationId`, `expectedRunId`, `requestId`, the new
  message and optional capabilities. Both return `{ conversationId, runId }`.
- `list` accepts an optional query, limit (default 50, maximum 100) and cursor
  `{ updatedAt, id }`. It returns `{ conversations, nextCursor? }`.
  A summary contains `id`, `title`, `head` (the unchanged RunView), `createdAt`,
  `updatedAt` and `turnCount`. `updatedAt` is the latest retained turn's creation
  time, not token activity. Ordering is updatedAt then id, both descending.
- `read({ runId })` returns `{ conversation, turns }`, with RunViews ordered from
  oldest to newest. A run can be inspected without losing the latest-turn identity.
- Each new thread's id is its first run id. Later turns persist an explicit
  membership and predecessor; no grouping by title, message similarity or time.
  Existing unlinked single-agent runs are independent singleton conversations.
  Replying through the new port adopts only the exact selected legacy run.
  Team runs stay in the existing Runs view, never in conversation threads.
- New-port sends are serialized per conversation. A persisted request receipt
  binds requestId to a normalized payload digest and the resulting run. Repeating
  the same request returns that result, including after restart; reusing the id
  with different content fails. Two different requests for the same old head
  cannot both append. Only a completed current head can accept a new reply.
  Active/paused/failed/cancelled heads keep the existing resume/new-run behavior.
- Run creation, membership and request receipt commit in one SQLite transaction
  before run events or drive/model/tool work start. A failed transaction starts
  no work. Recovery never creates a second run for a retained receipt.
- Existing run removal remains per run. Thread reads include only retained runs;
  deleting the last retained run removes the visible conversation. Deleted
  request receipts cannot recreate work or return an extant-run success. No
  conversation-wide destructive action, archive, rename or fork is added.
- Search is local, case-insensitive substring matching over masked titles and
  explicitly captured new-port user messages, not model/tool/system text.
  Legacy runs have no reliable authored-message index and are searched by title.
  Empty search reads metadata without loading every run snapshot. Search input is
  parameterized data, not SQL syntax. Mask all display/search text before matching
  or returning it; no new model calls, telemetry or network access.
- The desktop starts and replies through the new port, preserves the request id
  when retrying the same uncertain send, and never silently falls back to a
  non-idempotent legacy send. A definitive changed draft is a new intent.
  Late replies cannot navigate a different workspace/conversation.
- Home shows one conversation row with latest status and local search/pagination.
  Each conversation can expose its individual runs and their existing diagnostics.
  Team Runs and their exact task decisions remain intact. Historical run views
  remain readable; continuing an outdated turn requires returning to the head.
- Protocol 31 adds `mete/thread.start`, `.reply`, `.list` and `.read`. Inputs and
  outputs are strict schemas. Existing run events refresh the UI; no new event.
- No runtime dependency is added. Storage is owned by core and accessed through
  the same workspace database; contracts and the daemon remain the only UI bridge.

## Alternatives

UI-only grouping cannot preserve reliable relationships across restart. Replacing
run identities would unnecessarily change budgets, checkpoints and audit history.
Inferring old relationships from equal goals can combine unrelated conversations.

## Verification

Strict boundaries, unchanged legacy contracts, atomic rollback, duplicate/stale
sends, restart recovery, deletion without resurrection, masked search, paging,
workspace isolation and tool/taint inheritance require offline regressions.
Electron must demonstrate two sends as one sidebar row, reopening after restart,
search, history navigation and preserved team controls. Release and Linux checks
remain separate from Windows source-built acceptance.
