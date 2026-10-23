---
"@mete/security": minor
---

`policy.check@1` reads the policy again when `.mete/policy.yaml` or the global settings file changes, so a run paused on a policy ask decides by the edited file when it resumes (ADR-048, ADR-073). An edit that does not validate keeps the last valid policy and is logged.
