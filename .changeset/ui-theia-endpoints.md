---
"@mete/ui-theia": minor
---

The Settings screen edits custom endpoints in the providers section: name, slug, base URL, API format and extra headers, with Add and Remove, saved to the global `settings.yaml` or, on request, this folder's `.mete/providers.yaml` (ADR-087).
Each endpoint has an API key field: Set key saves the key of `custom:<slug>` through `mete key set` and restarts METE, and waits while a run of the folder is queued or running.
