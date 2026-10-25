---
"@mete/security": patch
---

`secrets.mask@1` loads secretlint's rules on the first mask instead of with the package, so a CLI start that masks nothing — `mete status`, `mete events` and `mete audit` among them — is faster: with the tools change, a median `mete status` start on Node 24.21.0 went from 1.75 s to 1.35 s (docs/15, performance budgets). The text that comes back is masked the same way.
