---
"@mete/gateway": patch
---

A model that rejects a request with a 4xx error now has its status and message logged once per process, so the reason a model never answers (and still costs a request on every call) can be found in the log.
