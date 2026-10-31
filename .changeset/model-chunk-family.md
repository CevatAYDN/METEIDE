---
"@mete/contracts": minor
"@mete/gateway": minor
---

The `model` chunk of `llm.chat@2` may carry the model's `family`, and the gateway sends it, so a later attempt of a best-of-N task can ask for another family than the earlier attempts ran on (ADR-162).
