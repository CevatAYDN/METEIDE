---
"@mete/quota": patch
---

Two METE processes (a `mete run` and the desktop's daemon) add their day and month usage in the saved quota table instead of replacing each other's rows, so a restart keeps both processes' calls (ADR-074).
