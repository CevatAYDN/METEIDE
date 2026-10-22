---
"@mete/contracts": minor
"@mete/core": minor
"@mete/cli": minor
---

The router: a run without a template asks the fast tier whether it is a single-agent task or one of the team templates; when it is unsure, `start` answers `choose_template` with suggestions (part of the unreleased `team.engine@2`). `mete run --single` skips it.
