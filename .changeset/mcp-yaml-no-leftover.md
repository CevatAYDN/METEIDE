---
"@mete/mcp": patch
---

`mete registry add` no longer leaves a `.mete/mcp.yaml.<pid>.tmp` file behind when the final rename fails, for example because an editor holds `mcp.yaml`.
