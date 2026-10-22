---
"@mete/mcp": patch
"@mete/cli": patch
---

OAuth tokens that are longer than one Windows keychain entry (1280 characters) are now stored in numbered pieces, so a JWT token pair can be saved.
