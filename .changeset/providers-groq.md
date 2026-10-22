---
"@mete/providers": minor
"@mete/cli": patch
---

Groq is a built-in provider: `mete key set groq` adds its free `openai/gpt-oss-120b` and `openai/gpt-oss-20b`. Its limits are learned from 429 responses and its privacy comes from `models.yaml` (no training on prompts).
