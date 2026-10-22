---
"@mete/gateway": minor
---

The gateway routes by model mode (ADR-042): `gateway.models: free | paid | both` (default `free`). In `both`, free models come first and paid ones after; a paid call reserves its estimated cost and settles its real cost against `gateway.dailySpendUsd` (default 1 US dollar, reset at 00:00 UTC). At the cap `both` goes on with free models and `paid` pauses with reason quota.
