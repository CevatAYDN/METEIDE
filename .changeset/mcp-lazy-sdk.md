---
"@mete/mcp": patch
---

The MCP SDK's client and server load on their first use instead of with the package: `mete status`, `mete events` and every other command that talks to no MCP server no longer read them. With the tools and security changes, a median `mete status` start on Node 24.21.0 went from 1.75 s to 1.24 s (docs/15, performance budgets). A run that calls a server loads the client on its first connection, and `mete mcp` loads the server when its module activates.
