---
"@mete/cli": patch
---

`mete run` no longer hangs at exit when it ends while a question to the user is still open: the terminal reader is closed when the command finishes.
