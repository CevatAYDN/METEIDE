# ADR-195: Local patches for advisories without a usable fixed release

Status: Accepted
Date: 2026-11-10

## Context

The release check (docs/15) failed on `osv-scanner` for advisories in
transitive dependencies that METE cannot move to a fixed version:

- `decompress@4.2.1` (GHSA-mp2f-45pm-3cg9, GHSA-hrh2-vp3x-79xf,
  GHSA-h39j-r5qq-r9mm, GHSA-jwp9-9v96-94mx): no fixed release; the
  maintained fork is ESM-only and Theia 1.76 `require`s `decompress`.
- `deepmerge@4.3.1` (GHSA-gcqx-w48m-w2h4): no fixed release.
- `glob@10.5.0` (GHSA-3g3m-2fjr-6pw4), `minimatch@10.2.6` and `@9.0.9`
  (GHSA-g3hv-75wg-m249), `diff@7.0.0` (GHSA-73rr-hh4g-fpgx): fixes exist
  only in new majors that are ESM-only or change behavior consumers rely on
  (Theia's `rimraf`, Mocha in `@theia/cli`, electron-builder).

The user required these problems fixed before publishing the update.

## Decision

- Fix each advisory in place with a minimal `pnpm patch` under `patches/`,
  reproducing the upstream fix where one exists:
  decompress refuses link entries, uses separator-aware containment, drops
  special mode bits and writes entries sequentially; deepmerge refuses
  `__proto__`, `constructor` and `prototype`; glob returns after an abort;
  minimatch bounds `**/..` expansion at 1024 parts; diff no longer captures
  header text with a line-anchored regex.
- `scripts/test/vendor-hardening.test.mjs` exercises every fix against the
  installed patched code (each test was checked to fail or hang unpatched)
  and runs in `pnpm test:scripts`, so `pnpm check` keeps it.
- Because scanners read versions only, list exactly these ids in
  `auditConfig.ignoreGhsas` and `osv-scanner.toml`, each naming its patch.
  No other advisory is ignored; no gate is weakened.
- Drop a patch and its ignore entry when the dependency reaches an upstream
  fixed version (for example a Theia upgrade).

## Consequences

The release check's security gates pass with the fixes actually present in
the shipped and build-time code. Each patch is maintenance cost and must be
rechecked when its package version changes; `pnpm install` fails if a patched
version disappears, which forces that review.

## Alternatives rejected

- Ignore the findings without patches: leaves the vulnerable code shipping.
- Force new majors through overrides: ESM-only or behavior-changing for the
  CommonJS consumers above.
- Wait for upstream: `decompress` and `deepmerge` will not be fixed.
