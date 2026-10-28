---
"@mete/knowledge": minor
"@mete/cli": minor
---

Each ended run (completed, failed or cancelled) leaves a report in the workspace journal, `.mete/knowledge/journal/YYYY-MM-DD.md`: its goal, team, status, models, tool calls per capability, failed calls with their codes, checkpoints, changed files and summary, built from the run's events without a model call; it stays when the run is removed (ADR-144).
