---
"@mete/ui-studio": minor
"@mete/ui-theia": minor
---

A blocked task now reaches the human who can lift it (ADR-110): the team view marks a task blocked by a guardrail's retries or a missing capability as waiting for you, and the Waiting for you strip names it, with Go on and with an instruction that becomes its next attempt. Before this, such a run showed the generic "The run waits for you" card, whose Resume repeats the policy's tool call and lifts no block, so the run had no way forward from the desktop.
