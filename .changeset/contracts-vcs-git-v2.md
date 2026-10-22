---
"@mete/contracts": minor
"@mete/tools": minor
"@mete/core": patch
"@mete/testing": minor
---

`vcs.git@2` adds the core's `worktree.create`, `worktree.remove` and `merge` operations (a task's worktree and branch are named by the run and the task, a merge conflict is undone and returned as `merge_conflict`); the model still offers only status, diff and commit. Roles that list `vcs.git@1` must list `vcs.git@2`. The vcs.git contract kit's harness also writes and checks files at absolute paths.
