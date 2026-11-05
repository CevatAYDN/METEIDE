---
"@mete/core": patch
---

A team run's snapshot keeps each task's worker session (its agent, turns, checkpoint, context snapshot and taint) beside its conversation, reset when the task starts, retries, is revised or unblocked, so a task resumes from its own state and not from the run's coordinator conversation; the team state lists the tasks whose dependencies are approved in template order, the first step toward tasks side by side (`TASKS_IN_FLIGHT`, ADR-174).
