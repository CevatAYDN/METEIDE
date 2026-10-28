---
"@mete/cli": patch
---

`mete/quota` and the quota-pause lines now name each custom endpoint as `custom:<slug>` with its state (ready, no key, used up, unusable), so a saved endpoint shows under Quota (ADR-154).
