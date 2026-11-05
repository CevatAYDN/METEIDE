---
"@mete/quota": patch
---

`settle` releases the reservation before it reads the observations, and an observation that is not of the contract is logged and dropped instead of throwing and keeping the hold.
