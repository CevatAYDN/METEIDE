---
"@mete/security": minor
---

A path inside a task's worktree is judged as the same path in the workspace by `never_allow`, the protected paths and the script manifests, so a worktree's copy of `.mete/policy.yaml` or `package.json` is as protected as the original. Before, a worktree copy matched none of them, and a merge would have carried the change back.
