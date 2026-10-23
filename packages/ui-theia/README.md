# @mete/ui-theia

The Theia extension of METE IDE: its commands and panels, and the connection to the core daemon (ARCHITECTURE, Daemon protocol; ADR-045). Layer 6. `apps/desktop` depends on it, because Theia collects extensions only from the dependencies of the application package.

Modules: none (not a MeteModule)

## What it contains

- A frontend module with one command, "METE: Status" in the command palette (docs/13, Design system). It asks the backend for the runs of the first open folder and shows their count and the newest five by status and goal, "Open a folder first" without a folder, or why the daemon gave none: it is not ready (what core-engine waits for, ADR-046), it stopped or keeps stopping (its exit code and last stderr lines), it refused, or its answer did not parse.
- A backend module with one RPC service (`/services/mete-daemon`, method `status`). The backend owns the daemon: the first call for a folder starts `mete daemon <folder>` on its own Node with `ELECTRON_RUN_AS_NODE=1`, one folder at a time (another folder replaces it), and the backend closes its input on exit, which is how a daemon is asked to stop. Checked on Windows 11: a daemon asked through its input frees its run lock in under 100 ms, but when the desktop quits the daemon is gone within a second and the lock stays, so the quit ends it first; the next start takes the stale lock over (a pid that is no longer alive) and a run that was running becomes paused with reason `user` until it is resumed (docs/07, recovery). A daemon that ended on its own starts again on the next call, at most 3 times in 5 minutes (ARCHITECTURE, Failure handling). There is no panel yet (shortcut: the first panel brings TSX and `@types/react`, event streaming and eager restarts).
- Every label and message goes through `nls.localize` (docs/05, Localization). The Turkish resource file is not written yet (shortcut: it joins the English and Turkish item of Phase 5).

Without a provider key the daemon still starts and the command says METE is not ready yet, with what core-engine waits for and how to add a key (`mete key set openrouter`); a key added while the daemon runs is seen after the daemon restarts (ADR-046). A run lock held by another `mete` command still stops the daemon, and the command says so.

## Decisions behind the layout

- The package is CommonJS (no `"type": "module"`, `verbatimModuleSyntax` off), because Theia's generated backend loads extension modules with `require` and reads `module.default` (ADR-002). It sets `experimentalDecorators`, because inversify's `@injectable()` and `@inject()` are legacy decorators; `emitDecoratorMetadata` stays off, so every dependency is a property injection, as in Theia's own classes.
- `package.json` has no `exports`: the generated application imports the module files by path (`theiaExtensions`).
- Only `@mete/contracts` may be imported from other METE packages, and only this package and `apps/desktop` may import `@theia/*` (dependency-cruiser rules `desktop-talks-to-the-daemon` and `theia-only-in-ui-theia`). The one `@mete/cli` lookup (`require.resolve` of its `package.json`, to find the `mete` entry file) is a path, not an import, and dependency-cruiser does not follow `require.resolve`, so no rule sees it.
- The backend is bundled into `apps/desktop/lib/backend`, so that lookup starts there: `apps/desktop` depends on `@mete/cli` as well.
- The bundle loads `dist/` of this package and the daemon runs `dist/` of `@mete/cli`, so run `pnpm build` before `pnpm --filter @mete/desktop bundle`.
- Tests: the host runs against a fake daemon, a Node script that speaks protocol version 2 over real pipes. The command test replaces two Theia browser modules (they need a DOM) with stubs; the window check covers the real wiring.
