---
"@mete/security": minor
---

Agents can no longer write, delete or restore any `.mete/*.yaml` file (privacy, gateway, quota, workspace and models too, not only the policy, bindings and MCP files) or anything under `.mete/teams/`: `policy.check@1` denies them with `protected_path` at every autonomy level (ADR-072).
