---
"@mete/contracts": minor
"@mete/quota": minor
"@mete/gateway": minor
"@mete/testing": minor
---

`quota.reserve@3` adds `usage()`, the pool read of the quota dashboard (ADR-054): one row per provider unit and scope with the usage in the current window, the effective limit (null while none is known), the next reset and the amounts still in the window. Every module that requires `quota.reserve@2` moves to `@3`.
