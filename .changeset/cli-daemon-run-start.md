---
"@mete/cli": minor
---

`mete daemon` answers `mete/run.start` (protocol version 3): it starts a run from team.engine@2's `RunStart` and returns its `runId`; the run's events reach the client as `mete/event`. A refusal keeps its `EngineError` code, and `choose_template` carries the router's suggestions.
