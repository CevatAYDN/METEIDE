---
"@mete/contracts": minor
"@mete/core": minor
"@mete/gateway": minor
"@mete/mcp": minor
"@mete/testing": minor
---

`llm.chat@2` adds the error `too_large` (ADR-056): no model of the chain can take a request this large. Core pauses the run with reason `no_model`, and the gateway's HTTP server answers 413. Every module that requires `llm.chat@1` moves to `@2`.
