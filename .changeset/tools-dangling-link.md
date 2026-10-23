---
"@mete/tools": patch
---

`fs.write@1` and `fs.edit@1` follow a link whose target does not exist yet, so a write through it is judged at the target's real path (outside the workspace it asks or is refused) instead of creating that target unchecked.
