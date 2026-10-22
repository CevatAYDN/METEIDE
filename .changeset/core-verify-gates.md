---
"@mete/core": minor
---

Verify gates run: a task's `verify: [{ run: "<command>" }]` commands run through `shell.exec@1` before the guardrail, and a failing one goes back to the agent with its output. A gate that names a capability is still not run.
