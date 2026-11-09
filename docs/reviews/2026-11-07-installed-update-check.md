# Windows installation and update check

Date: 2026-11-07. Target: the local Windows x64 PC.
Source revision: `c5d02494` (`feat(desktop): improve IDE workflows and secure MCP setup`).

## Scope

Install the real NSIS package for the current Windows user, launch that installed
copy with an isolated profile, and invoke its update command against the unchanged
GitHub feed. No release publication, model inference, certificate enrollment,
signature bypass, or application behavior change is part of this check.

## Observed before installation

- Neither HKCU nor HKLM's standard uninstall registry listed METE.
- Existing `%APPDATA%\METE` data was present and must remain unchanged.
- The unauthenticated GitHub releases API for `CevatAYDN/METEIDE` returned `[]`.
- The existing installer was older than the current source revision. It was
  rebuilt before installation.
- `pnpm check` exited 0: Biome checked 1320 files with no fixes; dependency-cruiser
  found no violations in 1538 modules / 5618 dependencies; all four script tests
  passed; Turbo reported `34 successful, 34 total`, all 34 cached.
- The production desktop bundle completed with zero errors after running outside
  the filesystem sandbox. Its initial sandboxed attempt failed on directory
  access. One `require.resolve("@mete/cli/package.json")` externalization warning
  remains; it did not fail the build.

Protected file SHA-256 values before installation:

| File | SHA-256 |
| --- | --- |
| `%APPDATA%\METE\mete.db` | `56692C1F259A65088D38D28B23EA1DD7D2AF1CE0F3286D3F3F22C68347E4728F` |
| `%APPDATA%\METE\settings.yaml` | `52419E7913D64E774FDE27D9D4ACEA09FC1527B1BEB5B0374AF37A28D6B9B90E` |

## Installation and live result

- `pnpm --filter @mete/desktop package:win` exited 0, including the packaged
  sqlite-vec resolution check. It published nothing.
- Installer: `apps/desktop/dist/installer/METE-IDE-0.0.0-x64.exe`,
  226161195 bytes. SHA-256:
  `272ed40a282a9b05f53a71407fa145aaa93ca2cd3c1cc9373591148b7b305183`.
  Before a subsequent release-check rebuild, these exact bytes and their matching
  metadata were preserved in `apps/desktop/dist/update-baseline-0.0.0-20261107/`.
  The ordinary installer output directory is mutable build output.
- Installer and application Authenticode status: `NotSigned`. Both SHA-512 entries
  in `latest.yml` match the installer, its file size matches, and its blockmap
  exists. No signature policy was changed.
- The actual NSIS installer ran with `/S /currentuser` and exited 0. Windows
  registered `METE IDE 0.0.0` and created the Start Menu shortcut `METE IDE.lnk`.
- Installed executable:
  `C:\Users\wwwla\AppData\Local\Programs\METE IDE\METE IDE.exe`.
  Its SHA-256 matches `win-unpacked/METE IDE.exe`:
  `E688A2C183423229114D0CB79366217AD50A8CC0C036C56A3176D58B0ED25F38`.
- The installed `resources/app/lib/backend/electron-main.js` matches the fresh
  source bundle, SHA-256:
  `0AFBFF8709DF2A3A89ED795ED0A43B9B776D23FD393E681919DB62B24A1234D7`.
- The installed `resources/app-update.yml` retains provider `github`, owner
  `CevatAYDN`, repository `METEIDE`. No local replacement feed was used.
- Launched that installed executable, not the repository's Electron or
  `win-unpacked`, with separate temporary APPDATA, THEIA_CONFIG_DIR and Electron
  user data. No workspace was opened and no model inference was requested.
- Used agent-browser over the installed application's CDP endpoint to click
  Help, then Check for Updates. The UI returned:

  > No METE IDE release has been published yet, so there is nothing to update to.
  > This is version 0.0.0.

- The main-process output recorded `Checking for update`; its error output
  recorded `No published versions on GitHub`, matching the empty public releases
  API and the user-facing result.
- [Observed installed-app screenshot](2026-11-07-installed-update-check.png).
- Fresh targeted tests: `pnpm --filter @mete/ui-theia exec vitest run
  test/update-check.test.ts test/update-main.test.ts test/update-command.test.ts`
  exited 0: 3 files, 17 tests passed. These use fakes, not a real update download.
- Closed the test window through File / Close Window; no METE IDE process remained.
  Disconnected the browser session and removed only the generated temporary
  profile. The installed application and Start Menu shortcut remain.
- Both protected files' final SHA-256 values exactly equal the values above.
  No application source, configuration, version, or release was changed; only
  this evidence note and its screenshot were added.

## Acceptance boundary

An empty release feed can prove the no-release handling, not a version upgrade.
ADR-137 makes update checking user-initiated, not automatic at startup. ADR-179
requires distinct real package versions and matched signed update artifacts for
the complete update acceptance. No such upgrade is claimed by this check.
