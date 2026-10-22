# @mete/ui-theia

The Theia extension of METE IDE: its commands and panels, and the connection to the core daemon (ARCHITECTURE, Daemon protocol; ADR-045). Layer 6. `apps/desktop` depends on it, because Theia collects extensions only from the dependencies of the application package.

Modules: none (not a MeteModule)

## What it contains

One frontend module with one command, "METE: Status" in the command palette (docs/13, Design system). Today it only says that METE is not connected to the daemon yet; there is no backend module and no panel (shortcut: the daemon connection is the next slice, and the first panel brings TSX and `@types/react`). The label and the message go through `nls.localize` (docs/05, Localization); the Turkish resource file is not written yet (shortcut: it joins the English and Turkish item of Phase 5).

## Decisions behind the layout

- The package is CommonJS (no `"type": "module"`, `verbatimModuleSyntax` off), because Theia's generated backend loads extension modules with `require` and reads `module.default` (ADR-002). It sets `experimentalDecorators`, because inversify's `@injectable()` and `@inject()` are legacy decorators; `emitDecoratorMetadata` stays off, so every dependency is a property injection, as in Theia's own classes.
- `package.json` has no `exports`: the generated application imports the module files by path (`theiaExtensions`).
- Only `@mete/contracts` may be imported from other METE packages, and only this package and `apps/desktop` may import `@theia/*` (dependency-cruiser rules `desktop-talks-to-the-daemon` and `theia-only-in-ui-theia`).
- The bundle loads `dist/`, so run `pnpm build` before `pnpm --filter @mete/desktop bundle`.
