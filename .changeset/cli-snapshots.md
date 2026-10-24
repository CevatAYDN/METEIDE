---
"@mete/cli": minor
"@mete/ui-studio": patch
---

In a folder without git, runs keep file snapshots in the global `snapshots/` folder and `mete rollback` restores them (ADR-080); the start line says that files the fs tools write can be restored and what commands change cannot.
