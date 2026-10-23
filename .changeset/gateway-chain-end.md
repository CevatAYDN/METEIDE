---
"@mete/gateway": patch
---

A model the provider answers 404 for is left out like a refused key, and a model chain that ran out after a failure that passes (network, a stall, server, rate limited) ends with `network`, so the run pauses and retries instead of failing (ADR-064).
