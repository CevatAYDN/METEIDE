---
"@mete/security": minor
"@mete/testing": minor
---

The security module answers a policy ask (ADR-121): each ask publishes `policy.asked` with its command or path masked, `policy.grant@1` lets the asked call through once (also on a tainted step) or for the rest of the run (not on a tainted step), and a command in the policy's `shell.always` runs at levels 1 and 2 unless the step is tainted. A grant never turns a deny into allow. `@mete/testing` gains the `policy.grant@1` contract kit.
