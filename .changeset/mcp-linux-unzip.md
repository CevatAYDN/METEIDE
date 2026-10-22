---
"@mete/mcp": patch
"@mete/cli": patch
---

On Linux, a managed binary that comes as a `.zip` or `.mcpb` bundle is opened with `unzip`, since GNU tar reads no zip; without `unzip` the error says so.
