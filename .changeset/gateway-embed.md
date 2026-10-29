---
"@mete/gateway": patch
---

The gateway provides `llm.embed@1` (ADR-152): it embeds through the embedding models that `provider.embed@2` adapters list, free ones first, after the model mode and the privacy filter, so NVIDIA's serve only with `allowTraining` on and never in a `sensitive` workspace. The input is masked, quota is reserved at the caller's priority and each call gets a `model_calls` row without its vectors. Nothing calls it yet; the knowledge layer's vector source comes next.
