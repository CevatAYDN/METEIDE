---
"@mete/cli": patch
---

`mete` warns at start when `METE_SCRIPTED_CHAT`, `METE_SCRIPTED_WEB` or `METE_SCRIPTED_BROWSER` comes from the environment rather than from the command, naming each variable, so a fake left in a shell (or passed down by the desktop to its daemon) no longer replaces the providers, the web or the keychain without a word.
