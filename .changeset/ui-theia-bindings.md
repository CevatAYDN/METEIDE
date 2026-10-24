---
"@mete/ui-theia": patch
---

The Settings screen edits the tool bindings as rows (ADR-096): one row per capability, its id and its adapters in fallback order, with Add and Remove. The card follows the scope switch and the save bar like the forms, writes `.mete/bindings.yaml` or the `bindings` key of the global `settings.yaml` in place, and refuses a bad capability id, an empty adapter list or the same capability twice.
