---
"@mete/contracts": minor
"@mete/security": minor
"@mete/cli": minor
"@mete/ui-theia": minor
---

Always allow now covers the same program with other arguments: for `npm test src/a.test.ts` it writes `npm test *` to `shell.always`, and the button reads "Always allow npm test *" (the terminal asks "always as npm test * (a)"), so the user sees what is granted. A command that a pattern could turn into any program (a flag in second place such as `node -e` or `pwsh -Command`, `npm exec`, `pnpm dlx`, `uv run`, `env`, `sudo`, a shell operator or a quote) is still written exactly, so `node *`, `python *` or `pwsh *` is never written. A command holding `*` is offered only once or for the run (ADR-158).
