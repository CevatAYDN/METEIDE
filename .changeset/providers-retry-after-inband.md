---
"@mete/providers": patch
---

A decimal, signed, past or out-of-range `Retry-After` no longer makes the gateway retry at once or throw, and an error a provider sends inside the stream keeps its message and maps to `rate_limited` or `server` instead of `network: [object Object]`.
