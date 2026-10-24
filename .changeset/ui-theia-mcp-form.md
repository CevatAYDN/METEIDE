---
"@mete/ui-theia": patch
---

The Settings screen edits MCP servers as cards (ADR-097): one card per server with its id, transport, and the fields that transport uses (runtime, command, arguments one per line, environment as `Name=value`, a binary server's URL and SHA-256, or a remote server's URL and sign-in), plus its permissions as boxes. The card follows the scope switch and the save bar, writes `.mete/mcp.yaml` or the `mcp` key of the global `settings.yaml` in place, and refuses what the contract's schemas refuse.
