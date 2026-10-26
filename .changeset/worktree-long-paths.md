---
"@mete/tools": patch
---

Remove a worktree's folder and branch even when git refuses `worktree remove`, as it does on Windows for a path longer than MAX_PATH (ADR-123).
