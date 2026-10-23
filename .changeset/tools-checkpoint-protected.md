---
"@mete/tools": patch
---

A checkpoint restore leaves every `.mete/*.yaml` file and everything under `.mete/teams/` as it is now, like the policy and `.meteignore` before (ADR-072); the artifacts and assets an agent wrote under `.mete/` are still undone.
