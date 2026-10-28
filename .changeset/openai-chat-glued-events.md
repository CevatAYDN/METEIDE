---
"@mete/providers": patch
---

Custom OpenAI-compatible endpoints whose streams glue `data: [DONE]` to the last chunk no longer pause every run with "JSON parsing failed": each `data:` line of a stream is read as its own event.
