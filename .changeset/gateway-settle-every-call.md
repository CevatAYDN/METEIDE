---
"@mete/gateway": patch
---

The HTTP endpoint settles the quota reservation and writes the `model_calls` row after every completed or failed call, and the pipeline also settles when a caller stops at the model chunk; before, every successful HTTP call held its reservation until the pool stopped granting.
