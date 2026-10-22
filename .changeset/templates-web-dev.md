---
"@mete/cli": minor
---

The built-in `web-dev` team: a UI designer briefs a static page, a frontend developer builds it in a worktree of its own and must pass `npm run build` before it can submit, QA builds the merged page again and audits the built folder with Lighthouse, and the lead approves each step. Run it with `autonomy: 3` and `overrides: { "shell.exec@1": 2 }` in `.mete/policy.yaml`.
