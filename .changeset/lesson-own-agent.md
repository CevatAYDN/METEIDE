---
"@mete/core": patch
---

A lesson's model call and its vault write name the task's own agent, not the lead that approved it, and the call sits between agent.thinking.started and agent.thinking.ended, so its tokens count like any model call's.
