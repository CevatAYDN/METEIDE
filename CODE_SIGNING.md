# Windows code signing

## Current status

METE IDE's locally generated installers are currently **unsigned**. No SignPath
Foundation certificate has been issued to this project and no sponsorship is
claimed. The project owner selected the free SignPath application route; account
enrollment and acceptance have not happened yet. A signature is not present merely
because a release build or a functional test succeeds.

The current version is pre-release. Release and update instructions must say which
installer was tested, whether its signature is valid, and whether it was published.

## Intended signing policy (pending owner/account verification)

- Only releases built from the public METE source repository may be submitted.
- The release must identify its exact source revision and pass the published local
  release checks. The optional trusted signing build must reproduce the selected
  revision and its locked dependencies, not ingest an arbitrary locally built EXE.
- Every release signing request requires approval by an owner-designated approver.
- Authors, reviewers and approvers must enable multi-factor authentication on both
  the source repository and signing service. Public role identities will be listed
  only after those people consent; a package author label is not role verification.
- Signing keys stay with the signing service's protected key custody. Credentials
  belong in the repository/account secret stores, never in source, logs or chat.
- Preserve upstream signatures. Third-party binaries may be distributed only under
  their applicable licenses and signing permissions; see THIRD_PARTY_NOTICES.md.
- Final executable and installer signatures must be checked before computing the
  published hashes and updater metadata. A trusted signature does not guarantee
  that Windows SmartScreen will immediately stop showing warnings.

These are the project's intended controls, not evidence that SignPath has reviewed
or accepted them. Final signer identity, project/policy IDs, public approver roles
and artifact configuration are set only after enrollment and review.

## Network and privacy disclosure

METE is a cloud-model workspace, not an offline application. Starting an agent can
send prompts, selected workspace context and tool results to the model providers
the user configured. Web tools and user-configured MCP servers may access their
own external systems. The application does not add telemetry. API credentials are
kept in the operating-system keychain; workspace history stays local. Provider
privacy rules, masking and permissions are described in SECURITY.md and
docs/09-models-providers-quota.md. Do not equate "no telemetry" with "no network".

Build-time dependency downloads, extension downloads and a user-requested update
check also access external services. Update packages come from the release source
configured in apps/desktop/electron-builder.yml. Users should review each configured
provider/server's privacy terms before sending private workspace content.

## Enrollment and release prerequisites

The owner needs to confirm MFA, author/reviewer/approver identities and the public
contact; approve a first tested public release; then review the Foundation's terms
and submit its application. Approval is discretionary and is not instantaneous.
See docs/superpowers/plans/2026-11-06-signpath-readiness.md for the readiness checklist.

Official information:
- https://signpath.org/terms
- https://signpath.org/apply
- https://docs.signpath.io/trusted-build-systems/github

## Verifying a delivered installer

In PowerShell, inspect the exact installer you downloaded:

```powershell
Get-AuthenticodeSignature -LiteralPath '.\METE-IDE-<version>-x64.exe' |
  Format-List Status, StatusMessage, SignerCertificate, TimeStamperCertificate
Get-FileHash -Algorithm SHA256 -LiteralPath '.\METE-IDE-<version>-x64.exe'
```

`NotSigned` is not signed. A self-signed certificate or a locally installed trust
root is not a replacement for publicly trusted project code signing. Compare the
publisher and hashes with the release's documented identity and final artifacts.
