---
"@mete/storage": patch
---

The database sets its busy timeout before switching to WAL, so a second process that opens it while the first one writes waits instead of failing to activate.
