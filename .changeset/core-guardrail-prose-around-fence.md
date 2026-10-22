---
"@mete/core": patch
---

A report wrapped in a sentence ("Here is the report: ```json ... ```") now passes the guardrail: the reply is read as JSON, else its first fenced block, before a repair attempt costs a model call.
