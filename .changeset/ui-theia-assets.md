---
"@mete/ui-theia": minor
---

The Assets view (ADR-114) lists the files tools save under `.mete/assets/`, newest first: an image shows its own picture, and every row names its media type, size, time and the MCP server and tool that saved it, joined from the manifest the client already writes. Other files open in Theia, a missing folder is the empty state, and a torn manifest line only shortens the list.
