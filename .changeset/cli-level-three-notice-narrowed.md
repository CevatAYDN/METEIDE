---
"@mete/cli": patch
---

The autonomy 3 notice is printed only for a run that writes outside a worktree: a single-agent run, or a team run without `vcs.git@2`. A team run in a git repository has worktrees for its writing roles and says nothing. The wording is unchanged because SECURITY.md quotes it.
