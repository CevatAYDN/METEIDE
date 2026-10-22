---
"@mete/contracts": minor
"@mete/tools": minor
---

`ToolContext` gets an optional `cwd`, a task's worktree: the fs, shell and vcs tools treat it as the workspace for that call and confine the call to it, while `.meteignore` still comes from the real workspace. A `.meteignore` rule anchored with `/` now reaches a worktree's root as it does the workspace's, which settles the Phase 1 shortcut.
