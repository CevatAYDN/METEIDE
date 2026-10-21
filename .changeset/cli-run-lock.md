---
"@mete/cli": patch
---

`mete run` holds `.mete/cache/run.lock`, so a second `mete run` in the same workspace refuses instead of pausing and re-driving the first one's run; `mete stop` also refuses while a `mete run` holds the workspace and points at Ctrl+C there.
