---
"@mete/tools": patch
---

Restoring a checkpoint (`mete rollback`, the Team panel's Restore) works again when the workspace vault is not committed and a note changed after the checkpoint, which every ended run's journal does. Before, git refused with "staged content different from both the file and the HEAD" and nothing was restored.
