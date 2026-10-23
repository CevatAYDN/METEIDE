---
"@mete/cli": minor
---

`mete audit [<run id>] [--json]` prints the workspace audit log, newest first, and `mete daemon` answers `mete/audit` (protocol version 7) with the rows filtered by run, verdict and action, also while core-engine is not active (ADR-053).
