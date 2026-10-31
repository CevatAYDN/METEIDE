---
"@mete/core": patch
---

A run's handoff, and the `handoff.created` event, list only the files a write or edit call changed. Before, a call that failed (a path outside the workspace, an edit whose text did not match) or one still waiting for approval was listed too, and `mete run --continue` sent the next run to a file that was never written.
