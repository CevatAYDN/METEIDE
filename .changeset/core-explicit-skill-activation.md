---
"@mete/core": patch
---

Load explicitly selected skills before the first single-agent or team-worker
model request. Retain the ordered snapshots before context budgeting, pause the
accepted run on load refusal, and discard late results after cancellation.
