---
"@mete/cli": minor
---

A `runtime: binary` MCP server in `mcp.yaml` now names its https `url` and `sha256`; METE downloads it on first start, checks the hash and puts its folder first on the server's PATH. `.mcpb` bundles are extracted like `.zip` archives (Windows only for now).
