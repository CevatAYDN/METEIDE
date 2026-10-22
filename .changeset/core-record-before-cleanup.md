---
"@mete/core": patch
"@mete/testing": patch
---

A task's merge is recorded in the run before its worktree is removed, so a crash between the two leaves a folder behind and no longer a run that merges again into a deleted branch. The vcs.git contract kit also checks that a merge which would overwrite the user's uncommitted edit fails with `io` and leaves the edit alone.
