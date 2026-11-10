# First published update validation

Status: user approved the bounded remediation and experimental versioning scope.
Implementation is running under the requested lead workflow; release gates and
download acceptance remain open. No release has been published.
Requested on 2026-11-07 against source revision `c5d02494`.

## Intended outcome

Publish an approved package newer than the installed `0.0.0`, invoke Check for
Updates in that installed copy against the real GitHub feed, and verify that the
complete downloaded bytes match the published package. Download acceptance is
separate from installation and trusted-signature acceptance.

The user explicitly authorized publication and the download test. This does not
silently waive the release checks of docs/15 or change ADR-033 / ADR-179.

## Current evidence

- The public `CevatAYDN/METEIDE` repository has no releases; the authenticated
  account has repository ADMIN permission.
- `pnpm changeset status` produces no package releases.
- Installed Changesets 3.0.3 / config 4.0.1 defaults `privatePackages.version` to
  false. This repository does not opt in, and its application packages are private.
- A read-only release-plan calculation with private versioning enabled finds 448
  pending changesets and 17 package releases: 16 at `0.1.0`, storage at `0.0.1`.
  This exceeds AGENTS.md's single-package / approximately 300-line task boundary.
- `0.1.0` is the documented public MVP, whose Phase 5 exit gate remains open.
  A desktop-only `0.0.1` experimental release path is not yet a documented
  alternative to the Changesets release process.
- The installed baseline's original installer and matching metadata are preserved
  in `apps/desktop/dist/update-baseline-0.0.0-20261107/`.
- The existing, unmodified `pnpm release:check` completed with exit 1:
  three of thirteen steps did not pass. Source HEAD remained
  `c5d02494f65abd3709ecd8c559b8fb5dfde43d4b`; no tracked source was edited.

## Release check result

The complete command output is retained in
`.probe-release-check-20261107.log`. The check ran, without skipping any step.

| Step | Observed result |
| --- | --- |
| pnpm check | pass |
| All tests, contract kits included | pass |
| Chaos | pass |
| MCP conformance | pass |
| pnpm audit, high and critical fail | fail: 19 findings, including 6 high; 2 critical findings were ignored by the existing audit configuration |
| Licenses of what ships | fail: metadata license `BSD` for `@vscode/windows-ca-certs` does not match the docs/05 allowlist |
| osv-scanner | fail: 17 affected packages, 23 findings: 2 critical, 8 high, 8 medium, 5 low |
| Desktop bundle | pass |
| Electronegativity | pass: 3 findings, none high outside the existing documented exceptions |
| End-to-end | pass |
| Accessibility step | pass; scope caveat below |
| Windows installer | pass: rebuilt `METE-IDE-0.0.0-x64.exe`, not a higher version |
| Packaged application | pass |

These are separate scanner counts, not a sum of distinct vulnerabilities or proof
that every source dependency finding is reachable in the shipped application.
No new vulnerability exception or license allowlist entry was added.
The generic `BSD` metadata requires review of the actual package license; it is
not by itself evidence that the underlying license is prohibited.

The accessibility step launched
`playwright test -- --grep @a11y`, and ordinary untagged IDE debugger, task and
workflow scenarios ran again. Thus this result is not evidence that the intended
narrow filter selected only accessibility tests. The command was not changed
during the run.

The public releases list and remote tags were still empty when checked during
the run. No version bump, commit, push, tag or release was performed. Existing
METE global database and settings SHA-256 values still match the installation
check's recorded baseline.

## Bounded work

1. Decide and document the first-release versioning scope.
   Recommended for this request: an explicitly experimental Windows `0.0.1`
   desktop package, preserving the pending workspace changesets and not claiming
   the `0.1.0` MVP. This needs an explicit approved exception / ADR for the
   desktop-only versioning path, not an unexplained manual manifest edit.
   Alternatively, approve the separate 17-package Changesets release preparation.
2. Implement the approved versioning path as a small, test-first change.
   Use the existing packaging tooling, retain `--publish never`, and verify that
   the staged application, installer and update metadata carry the same version.
   Do not add a dependency, consume unrelated changesets, or change updater trust.
3. Address the audit, OSV and license blockers in separate bounded tasks, using
   the detailed advisory/dependency paths and actual license text. Do not infer
   that a generic license label is acceptable, silently expand the allowlist,
   or blanket-ignore findings. Diagnose the accessibility argument forwarding
   separately, retaining the full end-to-end gate and the intended axe coverage.
   Keep the existing checks and their assertions; rerun the full documented gate
   on the exact release source. Missing / failed checks are not a successful
   release gate. Publication remains blocked even if the versioning exception
   is approved first.
4. Once the approved release requirements pass, publish the installer, blockmap,
   `latest.yml`, checksums and truthful release notes from the exact source
   revision. Disclose unsigned status and experimental acceptance limits.
5. Test the installed `0.0.0` using isolated application data. Check the real
   release, observe download completion and compare the cached package hash.
   A download-only test must not accidentally install on normal application quit.
   Do not disable signature checks or install a custom trust root.

The user subsequently approved the required work and requested lead-led usability
remediation too. ADR-185 records the narrow versioning exception. Publication
authorization stands, but neither this approval nor a worker's completion report
waives the mandatory release checks.

## Published and download-verified (2026-11-10)

`pnpm release:check` reported ready to release (13/13) on `df5a3311`.
Release `v0.0.1` was published with the installer, blockmap, `latest.yml` and
`SHA256SUMS.txt`. Using the installed 0.0.0's own `electron-updater`,
`app-update.yml` and version with isolated user data, the check found 0.0.1
and downloaded it (full download; 0.0.0 has no published blockmap). The
downloaded SHA-256 matched the published file
(`31c45048...5716595`). Auto-install on quit was off and the pending
download was deleted afterwards, so nothing was installed.
