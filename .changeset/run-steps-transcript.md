---
"@mete/contracts": minor
"@mete/core": minor
"@mete/cli": minor
"@mete/ui-studio": minor
"@mete/ui-theia": minor
---

The Team panel shows an agent's steps (ADR-125): a single agent's center lists what it wrote and each tool call as one line (`fs_read README.md`) that opens its arguments and result, and a team task's row in the Tasks tab opens that task's steps. A model call in flight counts its seconds ("Thinking… 42 s") in the steps and the Team view, and the member card shows a model chosen at start. The steps come from the run's saved conversation through `mete/run.transcript` (daemon protocol version 23), masked when read; events are unchanged.
