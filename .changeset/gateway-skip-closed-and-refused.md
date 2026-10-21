---
"@mete/gateway": patch
"@mete/cli": patch
---

The gateway now reaches models behind a provider whose quota is spent, instead of stopping at the first four candidates, and leaves out a model that refused the API key for the rest of the process, logging the provider's message. A run that fails because a key was refused prints a hint to check the keys with `mete key list`.
