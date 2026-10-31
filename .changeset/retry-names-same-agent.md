---
"@mete/core": patch
---

A first model call that fails and runs again, as after a quota or network pause, now names the same agent on both `agent.thinking.started` events, so a single agent, a reviewer, an answerer or a judge no longer leaves an agent id that no `agent.created` makes (docs/07). A restart still forgets the id.
