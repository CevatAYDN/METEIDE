---
"@mete/ui-theia": patch
---

The daemon host waits for the previous folder's daemon to close before it starts the next one, so two never hold a run lock at once; the Waiting card's "asks" verb is localized; unit tests cover the shown run and the update main service.
