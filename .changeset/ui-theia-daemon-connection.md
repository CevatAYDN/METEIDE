---
"@mete/ui-theia": minor
"@mete/desktop": minor
"@mete/cli": patch
---

"METE: Status" now asks the daemon: the desktop starts `mete daemon` for the open folder and says how many runs it has, or why the daemon is not running (a missing provider key, a run lock held by `mete run`). It starts a crashed daemon again, at most 3 times in 5 minutes. `@mete/cli` exports its `package.json` so the desktop can find the `mete` entry file.
