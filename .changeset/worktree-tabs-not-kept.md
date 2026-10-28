---
"@mete/ui-theia": patch
---

A file or page opened with Show files from a task's worktree no longer comes back after a restart as a "Not Found" or deleted tab: the worktree goes when the task lands, so its tabs are not kept (ADR-140).
