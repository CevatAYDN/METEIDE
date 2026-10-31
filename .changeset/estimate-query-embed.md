---
"@mete/core": minor
"@mete/gateway": minor
"@mete/cli": minor
---

The request estimate in the composer now counts the query embedding of each team task's lessons search: 1 request per start of the task's work (per attempt for best-of-N), put on the first ready provider of the embedding chain. It shows only while memory search is available and an embedding model is allowed; with the default privacy settings the embedding chain is empty, so nothing changes. The gateway module gains `embedChain(signal)`, the chain an `llm.embed@1` call would try, without a model call (ADR-152).
