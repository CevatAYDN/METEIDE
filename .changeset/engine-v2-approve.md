---
"@mete/contracts": major
"@mete/core": minor
"@mete/testing": minor
"@mete/cli": patch
---

The team engine capability is now `team.engine@2`: `approve(runId, { taskId?, decision, feedback? })` records the human's decision on a team task that waits for them (a human checkpoint, `approval: human` or a blocked task) and resumes the run.
