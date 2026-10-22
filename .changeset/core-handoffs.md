---
"@mete/core": minor
"@mete/cli": patch
---

A run leaves a handoff when it ends or pauses for anything but quota: its goal, where it stopped, the open question, failed tool calls and changed files, never prompts or tool output. `mete events` shows `handoff.created`.
