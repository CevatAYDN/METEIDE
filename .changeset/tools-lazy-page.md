---
"@mete/tools": patch
---

`web.fetch@1` loads linkedom, Readability and turndown on its first HTML page instead of with the package, so every CLI start that reads no page — `mete status` among them — is faster: a median `mete status` start on Node 24.21.0 went from 1.75 s to 1.47 s (docs/15, performance budgets). The fetched page is the same Markdown as before.
