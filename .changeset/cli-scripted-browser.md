---
"@mete/cli": patch
"@mete/tools": patch
---

`METE_SCRIPTED_BROWSER` answers a desktop test app's browser calls from a JSON file (ADR-117): its screenshots and Lighthouse reports answer `browser.screenshot@2` and `seo.audit@2` in order, the last repeating, so the tools write their own assets while no Chromium starts and nothing downloads. The variable is a test seam, unset in normal use, and `@mete/tools` now exports the `LhrSchema` its runner's answer is read with.
