---
"@mete/gateway": patch
---

The gateway settles an embedding's quota reservation also when the provider adapter throws; a paid chat call without `maxTokens` reserves 1,024 completion tokens so the spending cap holds it back; tool descriptions are masked like messages before they are sent and logged; the stall timer is cleared when a provider stream rejects; and a provider whose listing failed is asked again after 60 seconds instead of at every call.
