# SignPath readiness

Status: User selected the free SignPath route on 2026-11-06 and approved the optional
signed-release-only GitHub Actions exception on 2026-11-07 (ADR-179). Preparation
only; account linking, application submission and public release need owner approval.

## Observed state

- METE is Apache-2.0 and publicly hosted at https://github.com/CevatAYDN/METEIDE.
- The local installer is unsigned; no usable local signing credential was found.
- The public GitHub releases API returned no releases on 2026-11-06.
- The updater currently targets that repository. No actual installed-version upgrade
  has been proven; packaged offline functional tests passed separately.
- AGENTS.md disallows mandatory GitHub Actions. Local checks and unsigned packaging
  must remain usable without a signing service.
- `CODE_SIGNING.md` now records the current unsigned status, intended release policy,
  network/privacy behavior and verification commands. Public role identities and
  SignPath account identifiers remain unverified, not invented.

## Required owner actions

1. Enable/confirm MFA for GitHub and the SignPath account. Do not send tokens or
   recovery codes to the agent.
2. Confirm author/reviewer and release-approver identities and the public support
   contact to list in the signing policy. Repository ownership is not sufficient
   evidence to invent legal names or role consent.
3. Review the SignPath terms and submit https://signpath.org/apply as the project
   owner. Project acceptance, reputation review and turnaround are not guaranteed.
4. The optional signing-only trusted CI exception is approved in ADR-179. Their GitHub OSS
   connector requires all preceding jobs on GitHub-hosted runners: uploading a
   locally built installer does not satisfy verified origin.
5. Explicitly approve publishing a tested initial unsigned release if required for
   eligibility; current "already released" requirement is not met by a local EXE.

## Repository preparation (no submission or publishing implied)

1. Finish conversation usability and its acceptance tests before freezing a release.
2. Prepare a truthful Code signing policy with maintainer/approver identities,
   third-party license notices, user-controlled cloud processing and network behavior.
   Do not claim SignPath sponsorship until accepted. Review all redistributable
   dependencies for the no-proprietary-component condition.
3. Implement the smallest manually triggered
   Windows signing pipeline, separate from normal local development. Pin workflow
   actions and runtime inputs; use repository secrets, protected release approval,
   minimal token permissions and no secret-bearing logs. No workflow is added now.
4. Once admitted, configure organization/project/policy/artifact identifiers and a
   least-privilege submission token through the account UI and repository secret UI.
5. Specify which project binaries and NSIS layers are eligible before selecting a
   SignPath artifact configuration. Preserve upstream signatures; do not re-sign
   upstream binaries under this project's certificate without permission.
6. Produce signed executable/installer artifacts in the verified pipeline; enforce
   product name/version, trusted timestamp and expected publisher identity.
7. Verify Authenticode on the installed executable and installer. Only after the
   final signed bytes exist regenerate updater hashes, `latest.yml` and blockmap,
   compute SHA-256 checksums, and publish the approved matching set.

## Real update acceptance

- Install an explicitly labeled baseline version with owner permission.
- Publish an approved strictly newer signed version to the configured update feed.
- In the installed baseline use Help → Check for Updates, verify download and
  signature/hash, restart to install, and confirm the new version and retained user
  settings/history. Have no active agent write during installer replacement.
- A self-signed root, a successful download without installation, and an unpacked
  source build are not substitutes for this test.
- A valid trusted signature does not guarantee SmartScreen reputation immediately.

## Application facts ready to copy (not submitted)

- Project: METE IDE
- Repository/homepage: https://github.com/CevatAYDN/METEIDE
- License: Apache License 2.0
- Platform/artifact: Windows x64 Electron desktop application, NSIS installer
- Purpose: An open-source desktop workspace for individual and team AI-agent work,
  with user-configured cloud model providers, local workspace tools, approvals,
  quota pause/resume and MCP integrations.
- Signing policy/status: `CODE_SIGNING.md` in the repository. This is a preparatory
  policy; no Foundation certificate, approval or sponsorship is claimed.
- Release/build status: local unsigned installer and offline acceptance tests exist;
  no public release was observed. Optional trusted signing CI is approved as a
  design exception but not configured or executed.
- User data/network disclosure: no application telemetry; user-selected cloud model
  calls, web tools, MCP servers, dependency downloads and update checks are disclosed
  in CODE_SIGNING.md and SECURITY.md.

Owner identity, applicant contact, GitHub/MFA confirmation, reviewer/approver roles,
public release URL and final build-system identifiers must be supplied/approved by
the owner. Do not copy package metadata into these fields as a verified identity.

The live application form was inspected read-only on 2026-11-07. It asks for project
name, repository, homepage, optional download/privacy/Wikipedia URLs, tagline,
category, description, reputation, maintainer type, build system, applicant first/last
name and email, optional company, and discovery channel. It also requires agreement
to the Code of Conduct and personal-data processing. Those legal consent checkboxes
and Submit remain untouched; an agent must not invent reputation or consent.

## Official sources (checked 2026-11-06)

- Eligibility, MFA, existing release, signing/privacy policy, origin and approval:
  https://signpath.org/terms
- Application: https://signpath.org/apply
- Trusted build requirement: https://docs.signpath.io/trusted-build-systems
- GitHub-specific hosted-runner and artifact-origin checks:
  https://docs.signpath.io/trusted-build-systems/github
- Origin verification: https://docs.signpath.io/origin-verification
