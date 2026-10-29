---
"@mete/gateway": patch
---

The log line for a model left out of later calls says it refused the key or is not served, since a 404 for a listed model (a provider that no longer serves it) lands there too, not only a refused key.
