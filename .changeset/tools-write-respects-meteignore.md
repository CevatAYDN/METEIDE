---
"@mete/tools": patch
"@mete/testing": patch
---

`fs.write@1` refuses `.meteignore` paths like `fs.read@1` and `fs.edit@1`, so an agent can no longer overwrite or delete a file such as `.env`. The fs contract kit harness now also returns the workspace root.
