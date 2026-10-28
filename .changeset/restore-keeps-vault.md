---
"@mete/tools": patch
---

A checkpoint rollback in a git workspace leaves the workspace vault, `.mete/knowledge/`, as it is: the notes and run reports written after the checkpoint stay, while other files, `.mete/artifacts/` included, go back as before (ADR-146).
