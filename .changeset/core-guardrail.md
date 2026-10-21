---
"@mete/core": minor
---

A team task with a guardrail must report JSON that matches its artifact schema: a failing report is sent back for repair up to `max_retries` times, then the task is blocked. Templates whose guardrail names a type without a schema are refused when they load.
