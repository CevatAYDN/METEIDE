---
"@mete/cli": minor
---

`mete allow <run id> [--run | --always]` answers a run paused on a policy ask: it lets the call through once, for the rest of the run, or allows the command for good in `.mete/policy.yaml`, then resumes the run. In a terminal, `mete run` and the other commands that follow a run print the ask and ask the question themselves. `mete events` shows each ask, and the daemon answers `mete/run.allow` (protocol 21, ADR-121).
