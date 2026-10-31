---
"@mete/tools": minor
"@mete/cli": patch
---

`web.fetch@1` resolves the name of every hop and refuses it when any of its addresses is loopback, private, link-local, shared or unspecified, so a public name pointed at a local service or a cloud metadata address is no longer fetched; a name that does not resolve is `io` (ADR-171).
