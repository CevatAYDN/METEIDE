# ADR-183: Explicit editor context in conversation turns

Status: Accepted
Date: 2026-11-07
Approval: The user answered "devam et" to the C4-C5 proposal: explicit file or
selection snapshots, including marked unsaved edits, preview/remove/update,
backend path checks, masking, taint, versioned sends and bounded attachments.

## Decision

- Extend the existing conversation surface, not the editor. The user explicitly
  chooses Add selection or Add open file from the editor menu/palette or the
  composer's attachment menu. No automatic collection, saving or sending.
- Capture the current text immediately, before changing focus. A selection uses
  zero-based UTF-16 line/character positions with an exclusive end. The whole
  file has no range. `modified` records the editor's unsaved state, not a claim
  that the backend verified its content against disk. The text is user-supplied,
  untrusted context, never a trusted instruction or permission.
- Only an existing regular UTF-8 text file inside the current workspace qualifies.
  Untitled/remote resources, worktrees outside that workspace, NTFS streams,
  multiply linked files, links escaping the root, `.git/`, `.mete/` and the
  root `.meteignore` are refused by this attachment port. Existing fs tools and
  their read/write rules do not change. Check both the given path and resolved
  path against current `.meteignore` rules. An unreadable rule file fails closed.
  Link resolution checks intermediate targets and ancestors, with a 40-hop cap.
- A new native `fs.context@1` provides `inspect({ path }, signal)` returning
  `{ path }`, the canonical workspace-relative path, or `ToolError`. It is not
  offered as a model tool. Inspection reads at most the existing binary-sniff
  prefix and rejects binary/invalid UTF-8 there; the submitted text must also be
  valid Unicode without NUL. Large source files may supply a small selection.
- At most four attachments; each content at most 32 KiB UTF-8, total at most
  64 KiB; source paths at most 4096 characters. Empty content is refused.
  These are attachment limits, not a model-context guarantee. Refuse an
  overflow, never truncate it. Existing gateway context/quota limits still apply.
- Add `conversation.thread@2`, preserving all @1 and legacy ports. It provides
  @1 list/read plus `prepare`, `start`, `reply`, `context`.
  `prepare({ path, content, modified, range? })` inspects the source through
  `fs.context@1`, masks content with `secrets.mask@1`, and returns the normalized
  snapshot with its SHA-256. A digest identifies the preview, not authorization.
  No draft server cache, new database, expiration token or background upload.
- @2 start/reply take the @1 fields plus `attachments` (default empty). Each
  snapshot carries `{ path, content, modified, range?, sha256 }`. Immediately
  before a fresh admission the backend re-inspects all source paths and masks
  again. Changed normalization/masking/digest requires refreshing the preview;
  failed validation creates no run. Missing validation or masking never bypasses
  checks. Receipt replay is resolved first and does not reread files or launch.
- Request identity includes ordered attachment snapshots. Initial run snapshot,
  attachment metadata/content, membership and receipt commit atomically before
  drive/model work. Existing immutable-head, deletion and uncertain-retry rules
  stay in force. New-port empty attachments may use the existing @1 implementation.
- Prepared content is a fixed copy. Later editor edits do not mutate it; Update
  recaptures its same source/range, or reports unavailable without dropping the
  old copy. The UI shows path/range, unsaved marker and the exact masked preview.
  A successful send clears that draft only; failed/uncertain sends retain it.
  Navigation cannot attach late results to another conversation or workspace.
- Context is labeled as untrusted data in a separate user-context message;
  attachment-bearing runs start tainted and replies inherit taint. Only authored
  message text enters conversation title/search. Raw attachment content never
  enters events, global logs or error text. Masked snapshots are kept with the
  run, and `context({ runId })` returns `{ runId, attachments }` for its turn.
  Old runs return an empty list. Removal deletes snapshots with that run.
- Protocol 32 adds `mete/thread.context.prepare`, `.start`, `.reply`, `.read`
  with strict request/response validation and no downgrade on an unavailable port.
  Existing thread list/read and ordinary no-attachment sends are unchanged.
- The UI may add the already shipped `@theia/editor` exactly `1.76.0` as its
  direct dependency to access EditorManager. No other runtime dependency.
- Scope is single-agent starts/replies. Team attachments, images, drag-and-drop
  folders, remote files, disk-persisted unsent drafts and automatic file watching
  are out of scope. An in-memory draft survives navigation, not application exit.

## Consequences

The user can send exactly the selected editor text without saving it. File
eligibility is server-checked, but the backend does not attest that text came
from disk. This is not an OS sandbox or protection against another process
changing filesystem topology between checks. Masking is not a guarantee of
detecting every possible secret; the explicit preview remains important.

## Verification

Offline checks cover strict schemas/byte limits/ranges, ignored and protected
aliases, binary/invalid text, dirty snapshots, missing masking/inspection,
receipt replay, failed admission, restart, removal and taint inheritance.
Electron covers editor capture, preview/update/remove, failure retention,
single sidebar identity and reopened sent attachments in three themes and
narrow/wide panels. Linux and packaged-release acceptance remain separate.
