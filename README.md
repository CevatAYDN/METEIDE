# METE IDE

METE IDE is an open-source desktop agent workspace that runs teams of AI agents on free cloud models. Free models are the default; paid models are an option for those who want them (ADR-042). It is built for Windows first, with Linux next.

Status: pre-release. Phase 5 (the desktop app) is in progress, and no installer is published yet (ROADMAP.md).

## Run it from source

You need Node.js 24 and pnpm 11. On Windows, the desktop build also needs the Visual Studio C++ Build Tools (see `apps/desktop/README.md`).

```
pnpm install --frozen-lockfile
pnpm build
```

The command line works in the current folder:

```
node apps/cli/dist/bin.js key set openrouter    # reads the key from a hidden prompt, stores it in the system keychain
node apps/cli/dist/bin.js run "<goal>"           # the router picks a single agent or a team
node apps/cli/dist/bin.js status
```

The desktop app:

```
pnpm --filter @mete/desktop bundle
pnpm --filter @mete/desktop start
```

## Windows SmartScreen

Windows builds ship unsigned first (docs/15; free code signing through SignPath Foundation is part of Phase 7), so Windows SmartScreen will warn before the first start ("Windows protected your PC"):

1. Click **More info** in the SmartScreen warning dialog.
2. Click **Run anyway** to launch the installer.

If Windows Defender or your browser blocks the downloaded installer:
1. Right-click the downloaded `.exe` file and select **Properties**.
2. On the **General** tab, check the **Unblock** box near the bottom.
3. Click **OK**, then run the installer again.

## Documentation

- `docs/README.md`: the overview and the map of the specification
- `ARCHITECTURE.md`: layers, processes and the repository layout
- `docs/adr/README.md`: the accepted decisions
- `SECURITY.md`: autonomy levels, the policy file and the kill switch
- `CONTRIBUTING.md` and `AGENTS.md`: how to contribute, for people and coding agents

## License

Apache-2.0 (`LICENSE`). Third-party notices are in `THIRD_PARTY_NOTICES.md`.
