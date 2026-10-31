---
"@mete/core": minor
---

A team task with `attempts: { n: 2 or more }` now tries its work up to n times, one attempt after another, each with an agent and, for a writing task, a worktree of its own. An attempt whose guardrail repairs run out is spent and the next one starts; the attempts whose checks passed are the candidates. A lone candidate goes on; two or more go to a judge of `judge_tier` with no tools, which reads each one's report, changed files and diff and names the one that goes on, or, with no valid choice after one more ask, the first candidate goes on. `task.attempt.chosen` says which attempt and who chose it, and the others' worktrees are removed. The estimate counts the work n times plus one request for the judge. Questions before the work are asked once, a revision goes back to the attempt that went on, and Remove a run removes every attempt's worktree (ADR-162).
