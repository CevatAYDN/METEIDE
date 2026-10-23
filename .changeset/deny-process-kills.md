---
"@mete/contracts": minor
"@mete/security": minor
"@mete/cli": patch
---

The built-in policy denies, at every level, shell commands that end programs (taskkill, Stop-Process, kill, pkill, killall, a .Kill() call), and never_allow command rules ignore case (ADR-063). The game-studio tester no longer has shell.exec@1.
