---
"@mete/gateway": patch
---

A call whose caller stops reading at the finish chunk, as the core engine and the HTTP endpoint do, is logged with its finish reason and tokens and settles its actual token use; before, every successful call was logged as aborted with 0 tokens.
