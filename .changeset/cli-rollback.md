---
"@mete/cli": minor
"@mete/contracts": minor
---

`mete rollback <run id> <n>` restores a paused or ended run's git checkpoint n and prints how to undo it; the daemon answers protocol version 15's `mete/checkpoint.restore { runId, checkpointId }` with `{ ref, undo }` (ADR-079).
