---
"@mete/cli": minor
"@mete/kernel": minor
---

The daemon answers `mete/settings` (protocol version 16): each configuration section it loaded, merged and per file with the file's path, every string masked, also while core-engine is not active (ADR-081). The kernel exports `mergedSection`.
