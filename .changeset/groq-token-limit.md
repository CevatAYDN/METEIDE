---
"@mete/providers": minor
"@mete/cli": patch
---

Groq learns its tokens-per-minute limit per model from the `x-ratelimit-limit-tokens` header of a refused request (ADR-056), so a request too large for its free models no longer fails every Groq model and stalls the run behind an exhausted provider: the chain skips Groq, and a request too large for every model pauses the run with `no_model`.
