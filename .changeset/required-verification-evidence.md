---
"@mete/contracts": minor
"@mete/core": minor
"@mete/cli": minor
"@mete/mcp": patch
"@mete/testing": minor
"@mete/ui-theia": patch
---

Move native new-run execution to team.engine@3 with required verification gates,
explicit optional gaps and durable task/attempt evidence. Preserve saved legacy
run semantics, add template v2 optionality and protocol34 evidence reads, and show
truthful outcomes in the CLI and desktop. First-party consumers no longer fall
back to the legacy engine version.

Keep the completed-run status label readable against its success background in
the desktop themes.
