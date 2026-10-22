---
"@mete/contracts": minor
"@mete/core": minor
"@mete/cli": minor
"@mete/testing": patch
---

`team.engine@2` `start` takes `continue: true` (part of the unreleased @2): the run accepts the newest open handoff exactly once, opens with its body and takes its goal. `mete run --continue ["<goal>"]` uses it.
