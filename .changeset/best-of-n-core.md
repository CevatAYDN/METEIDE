---
"@mete/core": minor
---

A team task with `attempts: { n: 2 or more }` now tries its work up to n times, one attempt after another, each with an agent and, for a writing task, a worktree of its own. An attempt whose guardrail repairs run out is spent and the next one starts; the attempts whose checks passed are the candidates, a lone candidate goes on and `task.attempt.chosen` says so, and the others' worktrees are removed. Questions before the work are asked once, a revision goes back to the attempt that went on, and Remove a run removes every attempt's worktree (ADR-162).
