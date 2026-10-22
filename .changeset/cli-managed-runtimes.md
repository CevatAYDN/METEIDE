---
"@mete/cli": minor
---

MCP servers that run with `npx` or `uvx` now work without a preinstalled Node.js or Python: on the first server start METE uses a system Node.js 20 or newer, or downloads the pinned Node.js 24.21.0 or uv 0.12.23 into the global `runtimes/` folder after the `runtime.install` policy allows it, checks its SHA-256 and puts it first on the server's PATH. Container servers use `docker` or `podman` when one is on PATH.
