---
"@mete/contracts": minor
"@mete/core": minor
"@mete/security": minor
"@mete/tools": patch
"@mete/cli": minor
"@mete/ui-theia": minor
"@mete/desktop": patch
---

Add verified file-tool isolation and exact task-scoped policy requests. Preserve
pending task identities, allow independent work during human waits, and expose
per-task decisions in the desktop without changing persistent permission settings.
Serialize checkpoint allocation and refuse scoped hard-link and symlink escapes.
