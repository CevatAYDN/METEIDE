---
"@mete/core": minor
---

A tool call whose result is the same as that of its last two calls with the same arguments now goes back to the model with a line before it: the same call gave the same result before, so try another approach or report what blocks you. No model is asked and nothing pauses; the call still runs and the turn limit stays the stop. A read after a write starts the count again, because its result changed (ADR-166).
