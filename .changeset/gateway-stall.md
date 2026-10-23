---
"@mete/gateway": patch
---

A model call that sends nothing for 120 seconds at the start, or for 60 seconds between chunks, fails with `network` and moves to the next model instead of hanging the run (ADR-062).
