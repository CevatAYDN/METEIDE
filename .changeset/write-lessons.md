---
"@mete/core": minor
---

A team task with `memory: { write_lessons: true }` now leaves a lesson: once the task is approved and merged, its agent is asked once, without tools, for one `lesson@1` (title, lesson, evidence, tags), and the core saves it in the workspace vault's `lessons/` through `vault.write@1`. The question costs one cloud request of the budget; when no lesson can be had (no vault, no budget left, no model, a reply that is not a lesson, or a policy that asks), it is skipped with a warning and the run goes on (ADR-145).
