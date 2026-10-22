---
"@mete/security": minor
---

At autonomy 2, a write to a script manifest (`package.json`, `.npmrc`, `pnpm-workspace.yaml`, `.pnpmfile.cjs`, `lefthook.yml`, `.husky/`, `.git/hooks/`, `.git/config`) now asks instead of being allowed, because it changes which program an allow-listed command such as `npm test` runs.
