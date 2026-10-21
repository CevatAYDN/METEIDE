---
"@mete/tools": patch
---

`fs.write@1` with `delete: true` on a symbolic link removes the link and leaves the file it points to; checks still use the resolved target.
