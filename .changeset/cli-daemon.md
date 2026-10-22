---
"@mete/cli": minor
---

`mete daemon [<folder>]` serves a workspace to the METE desktop over stdio with JSON-RPC: the request `mete/status` lists the runs and the notification `mete/event` carries every event. Like `mete run` it holds the run lock with recovery on, writes only protocol to stdout and stops when the client closes its input or on Ctrl+C.
