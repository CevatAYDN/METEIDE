---
"@mete/core": minor
"@mete/testing": minor
---

File snapshots for folders that are not git repositories (ADR-080): core-engine (with `snapshotsDir`) copies each file an fs tool writes into the step's snapshot first, `checkpoint.restore@1` restores `snapshots/<run id>/<n>` refs by undoing every step from n on, and the 14-day prune removes old runs' snapshots without git too. The `checkpointRestoreContract` kit runs for both kinds.
