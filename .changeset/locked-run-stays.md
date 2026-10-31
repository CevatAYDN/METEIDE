---
"@mete/core": patch
---

A run that a locked database cannot give back when METE starts stays as it was, with a warning, and the next start recovers it. Before, any error while loading it marked the run failed for good. Only a snapshot that does not parse still marks the run failed (docs/07).
