---
"@mete/mcp": patch
---

`mete mcp` runs on the MCP TypeScript SDK v2 (`@modelcontextprotocol/server` 2.3.1) and still speaks protocol 2025-11-25 (ADR-163). It now ends when its host closes standard input, leaving calls in flight unanswered, and it answers a call to a tool it does not have with a protocol error (`-32602`) instead of a tool result marked as an error.

METE's MCP client moves to `@modelcontextprotocol/client` 2.3.1 too. A remote server's sign-in registers METE as a native client and, when the address the browser lands on names an issuer, takes the code only from the server it signs in to (RFC 9207); a remote server's redirect is followed only within its origin, and a stdio message over 10 MB closes the connection.
