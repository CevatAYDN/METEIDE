---
"@mete/contracts": minor
"@mete/gateway": minor
"@mete/ui-studio": minor
"@mete/ui-theia": minor
---

A model call whose provider reports no token usage (custom:noxery streams none, although METE asks for it) now counts the gateway's own estimate instead of 0: the prompt as the gateway already estimates it, the reply's characters divided by 4. Quota and cost settle with it, `model_calls` marks the row `tokens_estimated`, the finish chunk and `agent.thinking.ended` carry `usage.estimated: true`, and the Team panel's Tokens count shows `~` before its number while any call it adds up was estimated (ADR-168).
