---
"@mete/providers": minor
---

OpenRouter now honours the `allowTraining` privacy opt-in (it stops sending `data_collection: "deny"` when the user allowed training in a normal workspace), and reads its `404 No endpoints found matching your data policy` as a refusal of the account's settings, so the gateway leaves that model out instead of spending a request on it for every call.
