---
"@mete/core": patch
---

Tool results, the model's reply and a model error's message are masked through `secrets.mask@1` before the run stores them, so a secret a command printed no longer lands in `runs.snapshot`, the events table or the terminal summary. core-engine now requires `secrets.mask@1`.
