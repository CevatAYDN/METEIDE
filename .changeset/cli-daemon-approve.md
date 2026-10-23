---
"@mete/cli": minor
---

`mete daemon` answers `mete/run.approve` and `mete/run.resume` (protocol version 4): the desktop can approve or revise a team task that waits for the human and resume a paused run; both answer `null`, and a refusal keeps its `EngineError` code.
