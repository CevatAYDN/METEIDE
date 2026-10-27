---
"@mete/gateway": patch
---

A model whose call stalled goes to the end of the chain at once instead of after three failed calls, so a pinned or first-in-chain model that goes quiet costs one wait, not three (ADR-131).
