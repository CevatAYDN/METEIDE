---
"@mete/core": minor
---

Run known non-writing task queries in bounded task-local workers. Preserve peer
results through pause and drain failures. Persist writer merge order at final
approval; legacy pending worktrees retain their deterministic order.

Writing tools remain sequential until adapter worktree confinement is explicitly
specified and verified. Task-local policy approvals remain a separate decision.
