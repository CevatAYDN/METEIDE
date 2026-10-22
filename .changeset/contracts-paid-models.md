---
"@mete/contracts": minor
"@mete/providers": minor
"@mete/quota": minor
"@mete/gateway": minor
"@mete/testing": minor
"@mete/cli": patch
---

`provider.chat@2` adds the optional `ModelInfo.price` (US dollars per million tokens) and `quota.reserve@2` adds the unit `usd_per_day` (ADR-042). Every module now provides and requires the @2 refs.
