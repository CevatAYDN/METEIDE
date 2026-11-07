# ADR-184: Explicit MCP sign-in and target-bound credentials

Status: Accepted
Date: 2026-11-07

## Context

The user approved the T1-T3 plan in
`docs/superpowers/plans/2026-11-07-mcp-auth-and-secrets.md`.
Desktop setup cannot finish OAuth or required credential fields today.
Origin-only OAuth records also do not distinguish workspace, server path or
configuration. The existing SDK, OS keychain and idle restart flow remain.

## Decision

- Implement the approved plan in bounded package slices. The plan's security
  and acceptance requirements are normative, not optional follow-ups.
- Add `mcp.connection@1` and `registry.setup@1` management contracts and daemon
  protocol33. Do not change the existing tool/status/search/prepare contracts
  or expose management as model tools or METE MCP server tools.
- Bind credentials to the canonical workspace path and exact normalized server
  configuration. OAuth records also bind the resource, issuer and client.
  Never migrate origin-only records automatically; one new sign-in may be needed.
- Only an explicit user action starts interactive authorization or credential
  writes. Use the installed SDK's PKCE public-client flow, a system browser and
  a temporary random-port `127.0.0.1` callback. One pending flow per workspace,
  expiring after 300000 ms. Reject stale, duplicate, wrong-route/state/issuer
  callbacks. Cancellation, restart and timeout invalidate pending writes.
  Callback URLs are bounded to 8192 characters, codes to 4096 and state to 128;
  state is generated locally. Credential forms accept at most 32 fields and
  4096 characters per value. These are local input bounds, not protocol claims.
  The pending desktop flow polls local status every 750 ms, without probing a server.
  At most 16384 OAuth error-response bytes are inspected; protocol error codes
  survive, but raw server descriptions never reach the SDK's diagnostic logging.
  Token responses are bounded to 65536 bytes and validated even on HTTP 200.
- Stage OAuth registration and tokens together. Keychain records use bounded
  generations (1000 characters per piece, at most 64 pieces), writing the
  manifest last and serializing mutations per identity. Corrupt records fail
  closed. Forget is local cleanup, not remote grant revocation.
- Retain the terminal paste-back interaction with the new identity rules.
  Agent calls and status reads never initiate interactive auth or registration.
  Refresh may use already granted credentials for their exact target only.
- User-entered values use write-only CLI stdin; never argv, YAML, logs, events,
  response fields or persisted UI drafts. No read-secret API. Env fields reach
  only the selected child; HTTP headers reach only the selected endpoint.
  Credential-bearing redirects are refused. OAuth and manual Authorization
  headers are mutually exclusive. Exact-value redaction supplements masking.
- Required env/header metadata stays structured. Unsupported secret arguments,
  URL credentials and metadata are refused explicitly, not guessed or dropped.
  Additive `credentialFields` configuration stores only kind/name/required/
  secret/description metadata, never values, so incomplete registry setup
  remains incomplete after restart. Legacy configurations remain valid.
- Configuration and credential changes require authoritative idle admission.
  Unknown activity refuses; no active run is interrupted. Management remains
  usable without model-provider configuration. A status read starts nothing.
- Only successful handshake and tools/list means connected. Configured,
  untested, missing, expired, cancelled and failed remain distinct states.
- No new runtime dependency, live-account enrollment or release authorization.
  No new domain event is needed; management responses are explicitly polled.

## Consequences

Users can complete tool setup in the IDE without exposing stored secrets.
Older sign-ins are not reused across potentially different targets. Offline
fixtures prove local behavior, not real-account interoperability or release
readiness. Linux and packaged acceptance remain separate from Windows source QA.

## Alternatives rejected

- Embed terminal paste-back in a dialog: retains the failed redirect-page step.
- Implement a custom OAuth engine: duplicates the installed SDK.
- Share origin-only credentials: conflates workspace and resource identities.
