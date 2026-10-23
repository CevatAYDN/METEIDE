---
"@mete/ui-theia": minor
"@mete/desktop": patch
---

"METE: Status" now says "METE is not ready yet" with what core-engine waits for, for example a missing provider key, instead of reporting a stopped daemon: the daemon stays up without a key (protocol version 2), so it no longer counts toward the restart limit.
