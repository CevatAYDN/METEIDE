---
"@mete/contracts": minor
"@mete/tools": minor
"@mete/cli": patch
---

`browser.screenshot@2` and `seo.audit@2` also take a `folder`, a built site with an index.html in the workspace or the task's worktree. The browser runner serves it read-only on 127.0.0.1 for the length of the call, so a page built here can be audited without letting a caller name a local address. Roles that list `seo.audit@1` or `browser.screenshot@1` must list the @2 refs; `templates/seo-audit.yaml` does.
