---
"@mete/contracts": patch
"@mete/core": minor
"@mete/tools": patch
---

Support worktree setup command and complete node_modules cleanup (ADR-123):
- Core executes configured setup command (`.mete/worktrees.yaml` key `setup`) via `shell.exec@1` in the worktree directory right after worktree creation.
- Policy checks, audit logging, and tool events apply naturally, pausing the run if approval is required.
- Setup command failure is logged and emits a failure event, but does not abort the run so the agent can inspect the failure in its turn.
- Untracked dependencies such as `node_modules` (including junctions and symlinks) are removed recursively with `fs.rm` upon worktree landing.
