---
"@mete/mcp": patch
"@mete/cli": patch
---

Commands start faster: the MCP SDK loads only when a command first connects to an MCP server, signs in to one or serves `mete mcp`, not every time `mete` starts.
