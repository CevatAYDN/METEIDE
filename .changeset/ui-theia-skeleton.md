---
"@mete/ui-theia": minor
"@mete/desktop": minor
---

The desktop gets its METE extension, `@mete/ui-theia`: the command palette now has "METE: Status", which says METE is not connected to the daemon yet. Run `pnpm build` before `pnpm --filter @mete/desktop bundle`, because the bundle loads the extension's `dist/`.
