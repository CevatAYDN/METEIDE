---
"@mete/knowledge": patch
---

`mete vault restore` refuses a note path outside `.mete/knowledge/` with the same error as listing its versions does, instead of falling back to the unchecked path; nothing is read or written for such a path.
