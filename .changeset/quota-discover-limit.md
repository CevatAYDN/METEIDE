---
"@mete/quota": patch
---

A discovered limit no longer counts the refused call, so OpenCode Zen and custom endpoints stop sending one call per window that is sure to get a 429.
