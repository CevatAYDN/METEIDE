---
"@mete/cli": minor
---

`mete daemon` now serves even when core-engine is not active, for example without a provider key: it prints the reasons on standard error and answers `mete/status` with `not_ready` and the same lines `mete status` prints, so the desktop can explain what is missing. A held run lock or an invalid configuration still ends it with exit 1.
