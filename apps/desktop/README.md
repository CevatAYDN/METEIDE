# @mete/desktop

Theia + Electron application. Composition root. Theia is pinned to 1.76.0 (newest release at least 14 days old on 2026-10-21, published 2026-09-24) and Electron to 42.8.1, the version that Theia release requires (docs/05).

Modules: none (not a MeteModule)

## Run it

```
pnpm install
pnpm build                             # compiles packages/ui-theia (the bundle loads its dist/) and apps/cli (the daemon)
pnpm --filter @mete/desktop bundle     # generates src-gen/ and lib/ with esbuild
pnpm --filter @mete/desktop start      # opens the window
```

`pnpm build` does not bundle the application: the bundle is not part of the turbo graph yet, because its inputs and outputs are not known (shortcut: add it when the desktop gets a CI job that can cache `lib/`).

## What the first window contains

Only the Theia shell: the menu bar, the file navigator, the editor, preferences and messages (`@theia/core`, `electron`, `filesystem`, `workspace`, `navigator`, `editor`, `monaco`, `preferences`, `messages`). The METE extension (`@mete/ui-theia`) adds the command "METE: Status": it starts `mete daemon` for the open folder and says how many runs the folder has, or why not: METE is not ready (a provider key is missing) or the daemon is not running (`mete run` holds the folder). "METE: Start run" asks for a goal and starts a run in the folder. "METE: Set provider key" saves a key in the keychain the CLI uses and restarts the daemon. "METE: Quota" says whether each provider can carry a run on now. "METE: Open team panel" shows a run's tasks in To do, In progress and Done, or as a graph of what waits for what. A Home view in the left side bar lists the runs that wait for you (Approve, Revise, Resume) and the folder's recent runs, with why a run paused for quota waits, and follows their events ("METE: Open home", "METE: Refresh home"). The terminal (`@theia/terminal`, native `node-pty`) and the extension host (`@theia/plugin-ext`) are not in the first boot (shortcut: ADR-002 wants both, they join with the panels).

## Decisions behind the layout

- The package is CommonJS (no `"type": "module"`, and `verbatimModuleSyntax` is off in its `tsconfig.json`), because Theia's generated application is CommonJS (ADR-002). Every other package stays ESM, except `@mete/ui-theia`, the extension this application loads.
- `src-gen/`, `lib/`, `esbuild.mjs`, `gen-esbuild*.mjs` and `plugins/` are generated and ignored by git, Biome and dependency-cruiser.
- pnpm's strict layout hides packages that Theia's generated files import by name, so two things make them visible: `devDependencies` names the six build packages those files import (`esbuild`, `esbuild-plugin-copy`, `esbuild-plugins-node-modules-polyfill`, `resolve-package-path`, `yargs`, `@theia/bundle-plugin`), and `publicHoistPattern` in `pnpm-workspace.yaml` hoists the `@theia/*` extensions, `reflect-metadata`, `trash` and the native packages. `node-linker` is unchanged. Keep both lists in step with the Theia version when it is raised.
- `pnpm-workspace.yaml` lists every package with an install script. Three are allowed because the bundle copies their `.node` files: `@theia/ffmpeg`, `drivelist` and `native-keymap` (both N-API, so the same binary runs in Node and in Electron and `theia rebuild:electron` is not needed). `keytar` stays off: Theia loads it lazily for its own credential store, and METE keeps secrets in the operating system keychain (docs/05).
- On Windows the Theia build needs the Visual Studio C++ Build Tools (Theia's own prerequisite), because those three compile from source. It is a developer-machine tool, never a requirement for people who install METE (`winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"`). In that step Theia also replaces Electron's `ffmpeg` library with one that has no proprietary codecs and checks it.
