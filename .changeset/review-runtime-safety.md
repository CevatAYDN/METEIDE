---
"@mete/core": patch
"@mete/gateway": patch
"@mete/quota": patch
---

Recover uncertain writes in paused runs without replaying them, preserve workspace
knowledge during file-snapshot rollback, mask provider diagnostics, restore successful
models to their routing position, and retry quota persistence after transient storage
failures.
