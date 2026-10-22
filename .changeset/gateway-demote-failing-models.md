---
"@mete/gateway": minor
---

A model that fails three calls in a row (other than by a rate limit) now moves to the end of the chain until it answers once, so a model that rejects every request stops costing a request on every call.
