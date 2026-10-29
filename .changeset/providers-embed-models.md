---
"@mete/providers": patch
---

NVIDIA and openai-chat custom endpoints provide `provider.embed@2`: besides embedding, they list their embedding models, the ids their `embed` rows in `models.yaml` name that the provider still lists, while the chat model list stays chat only (ADR-152). Nothing uses them yet; the gateway's embedding chain comes next.
