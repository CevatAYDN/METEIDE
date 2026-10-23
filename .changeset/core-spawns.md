---
"@mete/core": minor
"@mete/contracts": minor
---

A `spawns` task's approved `task-list@1` becomes tasks of the same run (ADR-057): each entry gets its role's `spawn_defaults`, waits for the entries it names, opens with its acceptance sentences and is announced with `task.created`. A list that names an unknown role or reuses a template task's id goes back to the agent as guardrail feedback. `@mete/contracts` exports `TEMPLATE_DEFAULTS`.
