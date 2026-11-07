# T1-T3: Guided MCP authentication and credentials

Date: 2026-11-07
Status: Approved and implemented; Windows source and bounded desktop verification complete.
External-browser/account OAuth, Linux and packaged-release acceptance remain open.
Phase: 5. Existing ADR180-183 edits remain untouched.
Accepted decision: ADR-184. Existing changes and verification evidence are preserved.

## Current evidence

- `packages/mcp/src/infrastructure/oauth.ts` already implements the SDK
  OAuthClientProvider with PKCE, state and issuer discovery. Its callback is
  pasted into a terminal, and saved tokens/client registration are keyed by origin.
- `packages/mcp/src/application/sessions.ts` shares sessions between tool calls
  and probes. A failed interactive sign-in is remembered for that process.
- `packages/mcp/src/domain/registry-install.ts` reduces required environment
  variables and headers to text notes, losing structured setup information.
- Remote `McpServerSchema` has no header configuration. Guided setup rejects
  raw credential imports instead of silently ignoring them.
- `packages/ui-theia/src/infrastructure/key-service.ts` demonstrates the
  existing write-only CLI-stdin route to the operating-system keychain.
- ADR-163 keeps SDK 2.3.1 and MCP protocol 2025-11-25; neither changes here.
  ADR-164 explicitly left desktop sign-in for a later user-approved decision.

Protocol baseline comes from docs/10 and ADR-163: MCP 2025-11-25 and installed
SDK 2.3.1. The official 2025-11-25 authorization specification was inspected
on 2026-11-07, alongside the installed SDK provider interfaces. No upstream code
is copied. This work does not change the pinned wire revision.

## Recommended approach

Reuse the installed SDK and keychain. Deliver desktop OAuth first, then
keychain-backed required environment/header fields in the same approved series.
Keep existing configuration, tool-call ports and native editor-extension behavior.

Alternative: expose the terminal paste-back flow in a desktop dialog. Smaller,
but it retains the broken-redirect-page copying step and does not meet the
intended IDE workflow. A new custom OAuth engine or embedded login browser is
not proposed.

## Proposed user workflow

1. Choose a saved server or review a registry draft.
2. Show missing requirements and exact effective connection identity.
3. OAuth servers offer Sign in; supported credential fields use masked inputs.
4. Sign in opens the user's system browser only on an explicit click.
5. OAuth callback and token exchange stay in the backend. The card reports
   cancellation, expiration, failure or credentials configured.
6. Only a successful handshake and tools/list marks the exact connection
   Connected. Saving a key or receiving a callback does not.
7. Retry, cancel, replace a credential and forget the local sign-in are explicit
   actions. Forget does not claim to revoke the remote account's grant.

## Approved decisions

- Add small versioned management contracts, provisionally `mcp.connection@1`
  and `registry.setup@1`, and new local daemon routes/protocol33. These are not
  model tools and are not exported by METE's MCP server. Existing `mcp.tools@1`,
  `mcp.status@1` and registry search/prepare messages remain compatible.
- New credential identity is workspace plus exact canonical server configuration
  and resource identity; OAuth additionally binds discovered issuer and client.
  An id rename, different endpoint or changed executable never inherits secrets
  by matching its display name or origin.
- Origin-only legacy OAuth records are not automatically copied to new targets.
  One new sign-in may be necessary. The terminal paste-back interaction remains
  available, using the new identity rules. Cross-workspace credential sharing
  is deferred; global server configuration remains supported.
- Desktop OAuth uses the installed public-client PKCE flow and a temporary
  random-port 127.0.0.1 callback listener. One pending flow per workspace;
  five-minute expiration. Validate exact route, state, issuer and current
  connection identity; reject duplicate/stale callbacks. Cancel/timeout/restart
  closes the listener and invalidates pending writes.
- No new registration or browser interaction from an agent/tool call, startup,
  or opening Settings. Previously granted credentials may refresh for their
  exact resource; failed refresh becomes an explicit sign-in-required state.
- Stage registration/tokens until successful completion; cancellation must not
  overwrite a previous usable credential set. Bounded generation-based keychain
  writes publish their manifest last, serialize per profile, and reject partial
  or corrupt records. Forget reports incomplete cleanup as failure.
- User-entered secrets follow the existing CLI-stdin write-only approach.
  No secret-read UI/API is added. No plaintext secrets in YAML, command
  arguments, URLs, response fields, events, global logs or persisted UI drafts.
  Required environment values reach only the selected child process; remote
  header values reach only the selected connection. Apply exact-value redaction
  alongside existing masking at affected diagnostic/output boundaries.
- Save/configuration writes remain user actions. Active work is not interrupted.
  Credential changes and connection replacement require authoritative idle
  admission; unknown activity refuses. Reuse the current quiesce/restart path
  where possible instead of adding another run scheduler.
- Setup/status works without a configured model provider. A local status read
  does not connect, start a process, download a runtime or register a client.
- Initial guided fields cover supported environment variables and HTTP headers.
  Preserve structured required/name/secret/description metadata from the registry.
  Non-secret supported arguments retain their existing explicit setup path.
  Secret arguments, URL/query credentials and unsupported metadata are refused
  with an actionable state, never silently dropped or guessed.
- Keep OAuth and manually supplied Authorization headers mutually exclusive.
  Validate URLs and header names; do not allow credential-bearing redirects to
  another target. Remote login endpoints use HTTPS; loopback is for the callback.
- No new runtime dependency, live-account login, enrollment, publication or push.
  Servers that require an unsupported registration method remain explicitly
  unsupported; no provider impersonation or invented client credentials.

## Bounded implementation slices

Each slice owns one package and one concern, targeting about 300 changed lines.
Split further before exceeding that scope. Lead owns shared documentation and
integration; Sol workers receive disjoint write sets after approval.

| ID | Owner | Package / concern | Depends | Acceptance | Status |
| --- | --- | --- | --- | --- | --- |
| M1 | Lead | contracts: connection identity and safe states | ADR184 | strict schemas, no secret results | verified |
| M2 | Lead | contracts: sign-in lifecycle and structured requirements | M1 | stale/invalid input and compatibility | verified |
| M3a-M3c | Lead + Sol | mcp: records, durable cleanup and concurrency | ADR184 | partial write/corruption/concurrent write | verified |
| M4 | Sol | mcp: callback listener and cancellation | ADR184 | real loopback, state/issuer/replay/timeout | verified |
| M5a/M5b | Lead + Sol | mcp: provider persistence / session lifecycle | M3-M4 | no implicit interactive login, staged commit | verified |
| M6 | Lead | cli: safe management routes and host lifecycle | M5 | exact target, sanitized errors, idle guard | verified |
| M7a/M7b | Sol | ui-theia: controller / sign-in and local-forget view | M6 | late callbacks cannot retarget another row | verified |
| M8a/M8b | Sol | mcp: structured parser / adapter and regressions | M2 | unsupported metadata not discarded | verified |
| M9 | Lead | cli: write-only credential stdin command | M3,M8 | secret absent from argv/stdout/logs | verified |
| M10 | Lead + Sol | mcp: exact-target injection / output redaction | M3,M8 | no wrong target, redirect or echo leak | verified |
| M11 | Sol | ui-theia: required credential fields and save states | M7,M9-M10 | missing/configured/untested/connected distinct | verified |
| M12 | Lead | offline SDK/callback and Electron setup fixtures | M11 | split-layer offline checks and real keychain/restart; external-browser round trip open | implemented |
| M13 | Astra review | read-only security and UX review | M1-M12 | source findings corrected; runtime evidence recorded | verified |

Review corrections and actual check results are tracked in
`docs/reviews/2026-11-07-mcp-auth-and-secrets.md`. Initial independent review
rejected the snapshot. Corrections passed the Windows regression batch.
M12's external-browser/account round trip remains a separate acceptance boundary
and is not represented as an Electron OAuth pass.

## Verification and release boundary

Tests are authored first, then the coherent implementation is completed before
execution, as requested. Lead serializes the final `pnpm check` and targeted
Electron flows; failed paths are rerun after root-cause fixes. Tests use scripted
OAuth/HTTP adapters and local callback fixtures, never real model providers or
the user's accounts.

Required negatives include changed configuration during sign-in, callback after
cancel/restart, two concurrent attempts, malformed token/client metadata, wrong
issuer/state/resource, keychain failure/partial writes, refused refresh, missing
secrets, masked diagnostics, shadowed configuration and blocked active-work
activation. Test secret sentinels must not appear in UI responses, events,
logs, exported settings, child arguments or another server's environment.

Windows source acceptance, Linux/WSL, real-provider interoperability and packaged
release acceptance are separate. A fake OAuth success is not a real-account
verification. Executed results, visual evidence and remaining limits are recorded
in the review report; no blanket platform or release PASS is claimed.
