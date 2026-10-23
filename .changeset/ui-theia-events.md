---
"@mete/ui-theia": minor
---

The daemon's events now reach the desktop: the backend forwards each `mete/event` to every connected frontend with its folder, and the Home view asks again whenever a run of its folder changes, so it no longer needs Refresh to show a new run.
