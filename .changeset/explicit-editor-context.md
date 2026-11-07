---
"@mete/contracts": minor
"@mete/tools": minor
"@mete/core": minor
"@mete/cli": minor
"@mete/ui-theia": minor
"@mete/desktop": patch
---

Add explicit file and selection snapshots to single-agent conversations,
including unsaved editor text, masked preview, update and removal. Validate
sources and limits on the backend, retain immutable context with each turn,
and include attachments in exact idempotent sends without changing legacy ports.
