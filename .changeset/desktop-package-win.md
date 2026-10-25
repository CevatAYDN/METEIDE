---
"@mete/desktop": minor
"@mete/cli": patch
"@mete/ui-theia": patch
---

The desktop builds a Windows NSIS installer (ADR-115): `pnpm --filter @mete/desktop package:win` deploys the app with a real `node_modules` tree, rebuilds the native modules for Electron's ABI and packs `METE IDE-<version>-x64.exe` into `apps/desktop/dist/installer`. A packaged app ships `templates/` and `adapters/` as extra resources, and the daemon it starts reads them through `METE_TEMPLATES_DIR` and `METE_ADAPTERS_DIR`, so the built-in teams and the level 2 mappings work outside this repository. `pnpm release:check` now builds the installer and fails when no `.exe` is produced.
