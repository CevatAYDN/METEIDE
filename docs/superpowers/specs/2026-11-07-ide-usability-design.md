# IDE usability and integrations

Status: Direction and package-sized implementation plan approved by the user on 2026-11-07.
Scope: Phase 5, extending the existing Theia desktop. Superseded details are in ADR-180.

## Direction contract

THESIS: Familiar task-focused IDE controls; project work and the conversation take
priority over summaries and configuration internals.

OWN-WORLD: Retain the METE identity and semantic status colors, but use Theia's
neutral surfaces and UI type for operational panels. Compact 1px boundaries, 4px
controls and at most 8px repeated item frames; no nested section cards.
Studio remains the existing event-driven visual asset.

STORY: Open a project, choose a model, ask a question, inspect changes. Add a tool
without editing YAML, see whether it is connected, and explicitly enable its
capability group for a conversation. Find editor extensions in Extensions.

FIRST VIEWPORT: A compact conversation header above readable turns and a persistent
composer whose actions remain visible. Settings have a search field and predictable
categories; tools open with a list and Add action, not every technical field.

FORM: Existing IDE surface extension, code-first under the user-approved plan;
no new visual-world tournament or generated decorative assets.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish
review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## Behavior

- Conversation diagnostics move into details; pause/resume and human gates remain
  immediately reachable. Keep immutable completed runs and explicit team choice.
- Add conversation capability groups through `conversation.run@1`, a new capability
  with `start` and `reply` methods. Inputs are a goal/message, optional existing model
  preference, and `capabilities`: a unique list limited to `web.search@1`,
  `web.fetch@1`, `mcp.tools@1`. Files/shell/Git remain baseline. `[]` is the default;
  reply without a capability override preserves the predecessor's selection.
  MCP selection grants access to all configured MCP servers, not a claim of
  per-tool/server filtering. Existing team.engine@2 and run.reply@1 stay compatible.
  Selected capabilities persist in snapshots; all calls still pass policy, masking,
  quota and external-content taint handling.
- Protocol 29 adds `mete/conversation.start`, `mete/conversation.reply`,
  `mete/registry.search`, `mete/registry.prepare` and `mete/daemon.quiesce`. Registry search/prepare are
  read-only and available without an active engine. Prepare returns the existing
  official pinned server draft plus setup requirements; it never installs or starts.
  UI writes only through its existing user-action file service.
- The tool form supports remote URL, a local command with argument arrays, and
  JSON import of `mcpServers` maps or METE's validated `servers` list. Unsupported
  authentication/header fields fail with a useful message; nothing is silently
  dropped. Raw credentials are never requested by the simplified import path.
  Existing advanced env fields remain compatible, but guided credential-dependent
  registry entries are not represented as one-click-ready.
- Registry results are real source entries, not a hardcoded popular list. An explicit
  Prepare action returns a reviewable pinned entry. Missing required fields remain
  a setup-required state, never Connected. No install on search or automatic probing.
- Save and connect validates first, preserves comments/unrelated entries, checks
  active runs and refuses restart if status cannot be determined. While work is
  active, save only and show pending activation. A successful restart may then
  Test the selected saved server through the existing `mcp.status@1` path; no MCP
  tool call is made by a connection test. Cancel/remove need clear local intent.
  Review hardening: `run.quiesce@1.prepare()` performs the final idle check in the
  engine, counting pending starts and blocking future starts/resumes atomically.
  Paused tool calls drain without abort; only then may the host stop that daemon
  generation. `mete/mcp.test` accepts an optional expected server in protocol 29
  and compares it against unmasked loaded configuration inside the daemon, without
  exposing secrets through `mete/settings`. Unresolved catalog requirements keep
  their draft review visible and disable Add until supported setup is supplied.
- Settings search matches translated labels and section IDs. Advanced loaded values
  and source files are collapsible; saving errors are actionable without discarding
  drafts. Built-in tools are described as built-in, not falsely removable.
- Extensions reuse Theia's `@theia/vsx-registry` at exactly 1.76.0. Open VSX discovery
  is user-initiated; launch does not automatically fetch marketplace recommendations.
  VSIX and install/uninstall use native Theia paths with a clear third-party-code
  trust boundary. No claim every VS Code extension works, or runs in METE policy
  sandbox. New runtime dependency is approved by ADR-180; no Theia upgrade.

## Ownership and sequence

| ID | Owner | Files / dependencies | Done | Status |
| --- | --- | --- | --- | --- |
| U0 | Lead | docs, product record, current UI evidence | Decisions and source-backed gaps recorded | implemented |
| U1 | Sol UI | ui-theia styles, chat/settings presentation, matching tests | Compact controls, composer fit, settings search | verified in unit/Electron theme and width checks |
| U2 | Sol tools | ui-theia MCP form/wizard and matching tests | URL/command/import, review, safe connect | verified with local stdio fixture; remote auth open |
| U3 | Lead | contracts registry schema, CLI registry transport, UI catalog | Real search/prepare feeds wizard | unit/adapter verified; public registry UI acceptance open |
| U4 | Sol conversation | contracts/core/CLI/UI in ordered package slices | Explicit persisted capability-group selection | unit and two-turn Electron verified |
| U5 | Lead | desktop dependency/config, extension entry | User-initiated native extension management | entry/search verified; VSIX lifecycle open |
| U6 | Lead/Astra | final diff, scripted Electron, pnpm check | Evidence recorded with scope limits | check passed; see evidence report for final acceptance |

Shared daemon/index/service wiring belongs to the lead; workers communicate exact
exports for integration. Each concern is developed with focused tests first.
Checks run together after implementation, then only failed paths are repaired.
No commit/push is implied by this new task.

Evidence and remaining gaps are recorded in
`docs/reviews/2026-11-07-ide-usability.md`. The follow-on upstream-feature roadmap
is a separate proposed plan, not a claim that every reference feature is shipped.
