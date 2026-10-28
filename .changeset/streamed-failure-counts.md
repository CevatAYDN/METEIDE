---
"@mete/gateway": patch
---

A model that fails after it streamed part of an answer now counts that failure toward the three in a row that move it to the end of the chain, so a model that keeps dropping mid-answer, a pinned one included, no longer leads every retry of its paused run.
