---
"@mete/contracts": minor
"@mete/core": minor
"@mete/cli": patch
---

An approved team task's worktree is merged into the workspace before the next task starts and before the run completes: the core records a workspace checkpoint, merges the task's branch with a commit named after the task, and removes the worktree and branch. A merge that does not happen (a conflict, or the user's own edits in the way) publishes the new `task.merge.failed` event with the branch and the conflicting files and pauses the run for approval, keeping the worktree and branch; approving the task tries the merge again.
