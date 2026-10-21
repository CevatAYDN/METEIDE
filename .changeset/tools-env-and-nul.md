---
"@mete/tools": patch
---

`shell.exec@1` refuses more `env` keys that run code under an allowed command (bash tracing, exported bash functions, .NET profiler and startup hooks, names a shell cannot set), and a NUL byte in a command, `env` value or grep pattern answers `bad_input` instead of failing the run.
