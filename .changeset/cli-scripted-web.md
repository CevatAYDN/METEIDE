---
"@mete/cli": patch
---

`METE_SCRIPTED_WEB` answers a desktop test app's web calls from a JSON file (ADR-116): its results are what every `web.search@1` call returns and its pages are what `web.fetch@1` reads, while the app keeps its keys in memory, so a run that reads the web needs neither the network nor a key of the developer's. The variable is a test seam, unset in normal use.
