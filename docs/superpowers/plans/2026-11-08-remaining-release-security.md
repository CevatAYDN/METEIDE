# Remaining release security decisions

Status: proposed; implementation decisions below are not approved ADRs.
Date: 2026-11-08, Europe/Istanbul.
Evidence: `docs/reviews/2026-11-08-lead-work.md`,
`2026-11-07-release-security.md` and `2026-11-08-security-compatibility.md`.

## Boundary

The user authorized the experimental Windows release and bounded remediation.
ADR-185 still requires all thirteen release checks. Fresh scans after the eligible
fixes return two high pnpm advisory entries and eleven OSV findings across eight
package/version rows, including critical findings. No release is authorized by
these failing results. Changing the scanner threshold, renaming vulnerable
packages, or adding ignores is not a remediation.

Existing installed 0.0.0 and its preserved baseline artifacts stay available for
the eventual real GitHub-feed download test. A locally built 0.0.1 candidate is
not publication or download evidence.

## Proposed Slices

Each slice is independently reviewed, test-first, and limited to one dependency
concern with about 300 manual changed lines; generated lockfile churn is reviewed
separately. Do not combine these into an unreviewed full-stack upgrade.

1. **Archive extraction:** review the current build-time and extension-install
   consumers of `decompress`. Evaluate a maintained implementation, document its
   exact API, license, age and security behavior in a proposed ADR before adding
   a new runtime dependency. Exercise malicious paths/symlinks and ordinary
   pinned extension extraction. Historical build-only exposure is insufficient
   after user-installed extensions were introduced.
2. **Merge advisory reconciliation:** first resolve the upstream record conflict
   below. The CVE authority has rejected the reported `deepmerge` CVE; do not
   call it a confirmed vulnerability or replace the dependency solely from the
   stale scanner row. At final validation, refresh advisory data and retain the
   raw result. If it still blocks, document the discrepancy for an explicit
   release-policy decision or upstream correction, without silently adding an
   ignore. Any separately established consumer defect needs its own evidence
   and bounded compatibility-tested remediation.
3. **Browser schema chain:** choose an eligible supported browser dependency
   chain that accepts fixed Zod without forcing Zod 4 into a declared Zod 3 API.
   Verify the real Puppeteer/Lighthouse consumers and METE browser adapters,
   retaining fake network/model boundaries in automated tests.
4. **Mocha diff:** investigate a supported parent update or another reviewed
   solution for `diff`. The existing soft-hyphen regression stays until a
   documented upstream behavior decision replaces it with meaningful acceptance;
   never change its golden merely to make the security override green.
5. **Redirect handling:** after November 9, 2026 at 00:32:25.963 Istanbul,
   `follow-redirects@1.16.2` meets the age rule. Recheck registry integrity and
   consumers then; verify redirect behavior and sensitive-header protection.
6. **Glob matching:** `glob@14.0.2` becomes age-eligible November 11, 2026 at
   01:07:00.325 Istanbul, and `minimatch@11.0.1` at 01:26:03.755. Review every
   affected parent's APIs before either major upgrade, including Windows and
   Linux path behavior. Eligibility is not compatibility.

These are investigation and migration scopes, not claims that a replacement is
already selected, compatible or sufficient. A missing decision or unavailable
safe implementation remains an explicit release blocker.

## Source Correction, November 8

The official CVE record for `CVE-2026-93753` is `REJECTED`, dated
`2026-11-02T16:33:19.357Z`, because it does not describe a security vulnerability:
https://raw.githubusercontent.com/CVEProject/cvelistV5/main/cves/2026/93xxx/CVE-2026-93753.json

At this read, GitHub's `GHSA-gcqx-w48m-w2h4` page still lists deepmerge 4.2.0
through 4.3.1, no patched version, and Low / CVSS 4 score 2.7, last updated
October 27:
https://github.com/advisories/GHSA-gcqx-w48m-w2h4

The upstream issue also records the dispute and the November 2 rejection:
https://github.com/TehShrike/deepmerge/issues/273

These are conflicting source states, not proof that METE's whole dependency
graph is safe. The saved OSV count remains an observed scanner result, not a
count of independently confirmed exploitable defects. No scan was rerun after
the user's end-only testing instruction, and no scanner rule was changed.
The separate decompress path-traversal advisory still lists `decompress <=4.2.1`
with no patched version under that package name:
https://github.com/XhmikosR/decompress/security/advisories/GHSA-hrh2-vp3x-79xf

## Final Acceptance

- Regenerate/install one dependency slice at a time; retain `minimumReleaseAge:
  20160`, existing license rules and all current tests.
- Per the user's latest instruction, execute checks only after the approved
  development work finishes: installed-consumer checks, `pnpm check`, fresh
  audit/license/OSV scans and the complete `pnpm release:check`, sharing the
  runner's existing suite ownership instead of duplicating full runs.
- Verify application version, installer, blockmap, update metadata and hashes.
  Disclose signing status and preserve the source identity.
- Publish only after every mandatory gate passes. Test the installed baseline
  against the unchanged public GitHub feed, verify the completed cached download
  hash, and force-close the isolated download test before install-on-quit.
- Installation, trusted signing, native Linux acceptance and full MVP acceptance
  remain separate from download-only verification.
