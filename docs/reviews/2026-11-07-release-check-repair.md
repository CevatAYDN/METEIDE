# R2 Release-Check Repair

## Status

R2b follow-up implemented November 8, 2026; release acceptance remains OPEN.
pnpm 11.28.6 `getPkgInfo3` reads the original CAFS manifest through
`readPackageFilesAndManifest` / `readPackageFileMap`, but reports installed paths.
The installed patch therefore does not change the raw scanner's BSD group.

- New `scripts/license-metadata.mjs` Zod-validates the report and installed
  identity fields, returns Result failures, and corrects only the reviewed
  `@vscode/windows-ca-certs@0.3.4` entry with installed `BSD-3-Clause` metadata.
  Every reported path must resolve inside canonical `node_modules`; both
  `package.json` and `LICENSE` must resolve inside the canonical package directory.
  Canonicalization changes CRLF to LF only. The pinned LICENSE SHA-256 is
  `206d4ff536b874471338314df6a504dd70551fff81624bf097d107ff471f88ad`.
- `scripts/release-check.mjs` consumes that result and reports the correction
  evidence separately. ALLOWED, all 13 mandatory gates, scanner history and the
  existing package patch remain unchanged by R2b.
- Updated `scripts/test/maintenance.test.mjs`; new
  `scripts/test/license-metadata.test.mjs`,
  `scripts/test/maintenance-fixture.mjs`,
  `scripts/test/license-metadata-fixture.mjs` and
  `scripts/test/fixtures/windows-ca-certs-0.3.4.LICENSE`.
  The LICENSE was read in full before copying; only CRLF became LF. Main owns its
  NOTICE entry. Fixtures require no installed Windows optional package.
- Root `package.json` adds authorized devDependency `zod: 4.6.7` and lists both
  test files explicitly in `test:scripts`; no other root fields changed.
  Main completed lock/install; `node -p "require('zod/package.json').version"`
  returned `4.6.7`. R2 ran no pnpm or install command.
- Production-boundary regression was RED (exit 1 for valid patched evidence plus
  original BSD report) before implementation. Final direct
  `node --experimental-vm-modules --test scripts/test/maintenance.test.mjs scripts/test/license-metadata.test.mjs`:
  53/53 PASS, no skips. This retains the original 24 tests and their assertions and adds
  malformed/missing/changed evidence, wrong/mixed identity, directory escapes and
  valid-content symlink escapes for each evidence file, plus CRLF/internal links.
- Verification split: 18 maintenance cases (170 total lines) and 35 license cases
  (268 total lines), with the existing harness moved to a 98-line shared fixture.
  Test bodies moved verbatim; no skipped or duplicated cases. Production helper
  is 106 lines; license fixture helper is 48. All files are below 400 total lines.
- `node node_modules/@biomejs/biome/bin/biome check scripts/license-metadata.mjs scripts/release-check.mjs scripts/test/maintenance.test.mjs scripts/test/license-metadata.test.mjs scripts/test/maintenance-fixture.mjs scripts/test/license-metadata-fixture.mjs package.json`:
  checked 7 files, exit 0. `git diff --check`: exit 0.
- Read-only `readLicenseMetadata` against
  `.probe-release-evidence/.probe-release-licenses-after-r1.json` validated 721 rows and emitted exactly
  one correction with the pinned hash and one installed path. The raw report's
  digest remained unchanged. This is captured-report evidence, not a fresh scan.
- Main must rerun the actual production listing/release path and own NOTICE,
  docs/15 and lock integration. `pnpm check`, fresh release checks, builds, UI and
  Linux execution remain unrun by R2; no gate-closure claim follows.

Initial R2 history follows. Assignment began November 7; initial focused
verification completed November 8, 2026.
Base: `c5d02494f65abd3709ecd8c559b8fb5dfde43d4b`.

Initial R2 changed paths:

- `scripts/release-check.mjs`: removed the literal `--` from the accessibility
  invocation. It now requests
  `pnpm --filter @mete/desktop test:e2e --grep @a11y`.
- `scripts/test/maintenance.test.mjs`: exact argv regression, all 13 mandatory
  gates reported in order, nonzero exit for each failing gate, strict license
  checks, and isolated full-patch application with exact metadata comparison and
  preservation of the Spectre removal.
- `patches/@vscode__windows-ca-certs@0.3.4.patch`: appended only the manifest
  `license: BSD` -> `license: BSD-3-Clause` correction. Original binding hunk
  unchanged; no source or LICENSE text copied or changed.
- This report.

Evidence and checks:

- Before the runner change,
  `node --experimental-vm-modules --test --test-name-pattern='release forwards exact accessibility argv' scripts/test/maintenance.test.mjs`
  failed both cases on the extra `--`; after removal, both passed. The VM captures
  real release-script process argv and checks the desktop's unchanged
  `playwright test` script plus forwarded `["test", "--grep", "@a11y"]`.
  This is offline boundary evidence, not a live pnpm/Playwright/Electron launch.
- Before the metadata change,
  `node --experimental-vm-modules --test --test-name-pattern='windows-ca-certs patch' scripts/test/maintenance.test.mjs`
  failed because the manifest still said `BSD`. Full patch application now passes
  in an isolated fixture. Fixture context was corrected to include `homepage`;
  `git -c core.autocrlf=false apply` prevents the global Windows Git setting from
  converting fixture output to CRLF. Equality assertions were not weakened.
- Final `node --experimental-vm-modules --test scripts/test/maintenance.test.mjs`:
  24 tests, 24 pass, 0 fail. Effects are substituted; Git fixtures are temporary.
  Generic BSD, GPL, AGPL and unknown licenses remain rejected.
- Final `node node_modules/@biomejs/biome/bin/biome check scripts/release-check.mjs scripts/test/maintenance.test.mjs`:
  checked 2 files, no fixes applied, exit 0. Initial formatting findings were fixed
  only in those two files.
- Read-only installed-manifest applicability check, exit 0:
  `git -c core.autocrlf=false apply --check --include=*package.json --directory=node_modules/.pnpm/@vscode+windows-ca-certs@0._be3ed795e7babceec1f3b08756bdb2a3/node_modules/@vscode/windows-ca-certs patches/@vscode__windows-ca-certs@0.3.4.patch`.
- `git diff --check`: exit 0.

License primary evidence:

- npm version metadata query
  `Invoke-RestMethod https://registry.npmjs.org/@vscode%2Fwindows-ca-certs/0.3.4`
  identifies the exact name/version and reports the ambiguous `BSD` field.
- Upstream tag `v0.3.4`, resolved through the GitHub tags API, points to commit
  `bcda8d5e781ce1d67316b7c67a9214973fb341d3`. Its `package.json` also says `BSD`.
  Its LICENSE has the BSD 3-Clause heading and the source-retention,
  binary-retention and non-endorsement conditions.
- Primary files were read from
  `https://raw.githubusercontent.com/microsoft/vscode-windows-ca-certs/bcda8d5e781ce1d67316b7c67a9214973fb341d3/LICENSE`
  and the adjacent `package.json`. The installed LICENSE matches upstream after
  normalizing line endings; installed SHA-256:
  `37b41c6f1f881cea96d4912799769d6a6dcf9ed738af956efc586d660f2e3215`.
- `THIRD_PARTY_NOTICES.md` already identifies this exact dependency and existing
  patch as BSD 3-Clause. No allowlist, exception, license policy, dependency,
  capability contract or ADR changed.

Initial handoff, superseded by R2b above: main owned lock regeneration/install and
NOTICE integration. Installed metadata was still `BSD` at that initial handoff.
Main's later install corrected it, but the raw CAFS-derived scanner report stayed
`BSD`, prompting the production-boundary follow-up.

Not run: installs, lock regeneration, builds, Electron/E2E, release checks or
`pnpm check`. The latter invokes emitting `tsc -b` and wider tests, outside this
assignment's focused-tests/no-build fence. No readiness claim relies on those
unrun gates. No repository commits, account actions or persistent processes.
