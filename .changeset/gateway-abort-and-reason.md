---
"@mete/gateway": patch
---

An abort while the models are listed ends the call with `aborted` instead of `no_model`, so the run is no longer paused for a missing model. A call that moved down the chain and comes back to the chain's first model names it with reason `failed`, as docs/09 says.
