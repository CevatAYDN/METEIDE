---
"@mete/tools": patch
---

A cancelled or timed-out `shell.exec@1` call on Windows always ends: a child the shell started during the kill is found by its parent id and killed, and the output is closed.
