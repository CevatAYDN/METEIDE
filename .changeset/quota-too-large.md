---
"@mete/contracts": minor
"@mete/quota": minor
"@mete/gateway": minor
"@mete/testing": minor
---

`quota.reserve@4` answers `too_large` when no chain entry could ever fit a request, where it used to throw (ADR-056); the gateway ends such a call with `too_large`, which names the token estimate, and logs it. Every module that requires `quota.reserve@3` moves to `@4`.
