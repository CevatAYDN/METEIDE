---
"@mete/security": minor
"@mete/cli": minor
---

`mete policy check "<command>" [--json]` says what the folder's policy decides for a command without running it: the verdict (`allow`, `ask` or `deny`), the rule that fired, and on `ask` the entry Always allow would write to `shell.always`, or why Always would not help. It checks untainted and without any run's grants, writes no audit row and starts no module. Exit codes: 0 allow, 2 ask, 1 deny or a policy file that does not validate. `@mete/security` exports `checkCommand` for it (ADR-167).
