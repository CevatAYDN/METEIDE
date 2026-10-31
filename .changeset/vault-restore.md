---
"@mete/knowledge": minor
"@mete/cli": minor
---

`mete vault restore <note path>` lists the versions `.mete/knowledge/.history/` keeps of a vault note, newest first, and `mete vault restore <note path> <timestamp>` brings one back as it was, after keeping the note as it is now, so a restore can be undone too (ADR-173).
