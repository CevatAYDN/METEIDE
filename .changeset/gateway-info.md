---
"@mete/gateway": minor
---

`createGatewayModule()` returns `info(models, signal)` beside `models` and `chain`: the listed `ModelInfo` of the asked models, in the order asked, from the cached listing, with no model call and no quota reservation, for the Team view's context share (ADR-090).
