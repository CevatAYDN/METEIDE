---
"@mete/core": minor
"@mete/tools": patch
"@mete/testing": patch
---

A team task whose role writes files or runs commands now works in a git worktree of its own: the engine starts it through `vcs.git@2` when the task first starts and runs the task's tool calls, checkpoints, verify gates and review there. Without `vcs.git@2`, or in a repository without a commit, the task works in the workspace as before. Nothing merges the worktree back yet. `worktree.create` returns the existing worktree when a run and task already have one.
