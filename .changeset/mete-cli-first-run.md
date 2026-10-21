---
"@mete/cli": patch
"@mete/core": patch
"@mete/kernel": patch
---

First runnable CLI: `mete run "<goal>"` runs a single agent in the current repository with free providers, prints one line per event, pauses on exhausted quota and resumes at the reset; `mete status`, `mete stop` and `mete key set|delete|list` (keys go to the operating system keychain).
