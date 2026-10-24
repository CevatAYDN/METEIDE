---
"@mete/core": minor
---

core-engine provides `checkpoint.restore@1` (ADR-079): it restores a paused or ended run's git checkpoint after recording the current state as an undo checkpoint, and publishes `rollback.performed`.
