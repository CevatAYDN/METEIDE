---
"@mete/tools": minor
"@mete/cli": patch
---

`browser.screenshot@2` and `seo.audit@2` refuse a page address whose name resolves to a local address, and a screenshot lets each request of its page through only when its host resolves to public addresses (ADR-171).
