---
"@mete/core": patch
---

Context compaction now counts the arguments of tool calls, so a long task with large file writes is summarized before it overruns the model's window.
