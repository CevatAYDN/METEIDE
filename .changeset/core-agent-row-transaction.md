---
"@mete/core": patch
---

The run row and its agent row are written in one transaction, so `agents.requests` can no longer fall one behind the run after a crash.
