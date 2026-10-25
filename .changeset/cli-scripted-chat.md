---
"@mete/cli": minor
"@mete/providers": minor
---

The desktop's end-to-end tests can answer a run from a file: `METE_SCRIPTED_CHAT` names a JSON script of chat turns (one array of chunks per model call, the last repeating), and the daemon then uses the `provider-scripted` module instead of every provider, so a test run needs no provider key and reaches no network (docs/15, ADR-111). The variable is unset in normal use; the daemon, the gateway, the engine, the tools and the panels stay the real ones.
