---
"@mete/contracts": minor
---

`agent.created` may carry `attempt { k, n }`, the attempt of a best-of-N task the agent works, and a new event `task.attempt.chosen { attempt, of, by, reason? }` says which attempt goes on, chosen by its checks or by a judge (ADR-162).
