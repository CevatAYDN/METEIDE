---
"@mete/core": patch
---

Report a model change as the user's only when the call used the run's own preferred model: a chain that fell past it keeps the gateway's reason, and a workspace pin is no run preference (ADR-122, ADR-077).
