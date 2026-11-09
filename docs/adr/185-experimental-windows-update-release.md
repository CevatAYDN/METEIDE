# ADR-185: Experimental Windows update release

Status: Accepted
Date: 2026-11-08

## Context

The user approved publishing a package newer than the installed `0.0.0` and
verifying its real download. Changesets currently excludes private packages.
Enabling private-package versioning would consume 448 pending changesets across
17 packages and advance the desktop to the public MVP version `0.1.0`.
The user approved the narrower experimental Windows `0.0.1` path after this
scope and the failed release gates were reported.

## Decision

- For this one experimental release, seed only `apps/desktop/package.json` to
  `0.0.1` directly. Keep it private and retain every pending workspace changeset.
  Other package versions and the general Changesets policy of ADR-033 stand.
- The package MUST come from the identified source revision and carry `0.0.1`
  in its application manifest, installer and updater metadata. Renaming a
  `0.0.0` installer is not a version increase.
- All thirteen checks of `pnpm release:check` remain mandatory. No new advisory
  ignore, license exception, shortened test, or trust bypass follows from this
  versioning exception.
- Publication uses the existing configured GitHub update feed. Notes MUST call
  the Windows package experimental and disclose its actual signing status.
  This is not the public MVP and does not close the Linux or Phase 5 exit gates.
- This authorization covers publication and download validation, not account
  enrollment or signing approval. ADR-179's signed update acceptance stays open.
- Download validation MUST use the installed baseline with isolated test data
  and verify the downloaded package's digest against the published artifact.
  It MUST NOT accidentally trigger installation when ending a download-only test.

## Consequences

The requested update experiment can use a real higher application version
without consuming the workspace's first-release changelogs. The normal MVP
release still requires deliberate Changesets preparation. The experimental
package cannot be published while any mandatory release gate is failing.

## Alternatives rejected

- Release the entire pending Changesets batch now: outside this experiment and
  premature for the documented MVP boundary.
- Rename the baseline or use a local fake feed: neither proves the requested
  public-release download.
- Disable security/signature checks or widen license rules: unrelated to the
  versioning issue and not authorized.
