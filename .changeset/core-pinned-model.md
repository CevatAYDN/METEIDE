---
"@mete/core": minor
---

A team task's agent asks for its role's pinned model from the folder's `.mete/pins.yaml`, read when the agent is seated, so a saved pin needs no restart; a pins file that cannot be used is logged and ignored. `agent.created` carries the role's tier (ADR-077).
