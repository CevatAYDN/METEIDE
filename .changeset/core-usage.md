---
"@mete/core": minor
---

`agent.thinking.ended` carries the token counts of the model call it closes, `usage: { prompt, completion }`, when the call finished; a call that ended with an error or was aborted closes with an empty payload as before (ADR-090).
