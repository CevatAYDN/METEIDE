---
"@mete/core": minor
"@mete/cli": minor
---

A run paused for lost network now tries again by itself every 30 seconds instead of waiting for `mete run --resume`, and `mete run` keeps waiting for it like it does for a quota pause.
