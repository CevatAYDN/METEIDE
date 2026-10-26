---
"@mete/ui-theia": patch
---

Keep a model field's blur from clearing a run's model preference, offer the model choice only while the run is queued, running or paused, and send no request when the chosen model is the one the run already prefers (ADR-122).
