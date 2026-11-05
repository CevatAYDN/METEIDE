---
"@mete/mcp": patch
---

Closing a stdio MCP server on Windows ends its whole process tree, so an `npx` or `uvx` wrapper no longer leaves the real server running; a server's tool description is cut to 1,000 characters when listed; a level 2 mapping whose arguments do not render to an object is refused with `bad_input` instead of being sent as they are.
