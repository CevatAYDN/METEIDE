# OmniRoute and FreeLLMAPI connections

Status: Deferred at the user's request on 2026-11-06. Do not implement either integration as part of the current development work.
Date: 2026-11-06
Phase: 5
Scope: Account-first connections to OmniRoute and FreeLLMAPI, with a guided IDE experience and no mandatory YAML editing or local server setup.

## User decision

Connect both services rather than implement their upstream providers separately. The user expects to connect an existing membership, see the models that account can use, select one and work, as in familiar coding IDEs.
The earlier proposal's mandatory self-hosting and manual model configuration do not meet that requirement and are withdrawn.
Do not assume membership includes inference, a particular endpoint, an OAuth/device authorization flow, a free quota, or access to every catalog model. Verify the supported account connection before promising it.
Keep the ADR-174 parallel-worker work as a separate open task; no core implementation was changed during this investigation.

## Verified findings

| Source | Finding | Integration consequence |
| --- | --- | --- |
| OmniRoute website, API reference and Cloud hosting terms [1, 2, 9] | OpenAI-compatible gateway; managed Cloud hosting is also offered. Cloud terms say hosting does not include inference, provider subscriptions or credentials. | Support the actual account-provided inference connection when verified. A Cloud website login is not evidence that third-party IDE OAuth or inference access is available. |
| FreeLLMAPI website, API reference and key guide [3, 4, 10] | The published setup uses a router endpoint and unified bearer key; Premium sells catalog updates. | A Premium membership alone has not been verified to grant hosted inference. Confirm what the user's account exposes; do not silently substitute a local installation. |
| FreeLLMAPI model listing [4, 5] | `/models` includes unavailable entries and virtual routes. Entries expose context and supported parameters, but the inspected listing does not expose per-model price or privacy. | Discover account-usable models and resolve missing facts through supported APIs or verified integration data. Do not shift this work to the user as YAML editing. |
| FreeLLMAPI request routing [5] | Unified groups constrain fallback to group members; legacy single-row selection can prefer a model without constraining the whole fallback chain. | An exact requested ID alone does not establish upstream identity or privacy. Document and verify the configured route's possible destinations. |
| OmniRoute free-tier reference [6] | Free access depends on connected accounts and eligibility. Recurring allowances, signup credits and paid routes are distinct. | Do not import headline token totals as the user's available quota. |
| Both repository licenses [7, 8] | MIT. | Reuse the protocol through METE's own implementation. If upstream code, fixture payloads or substantial documentation are copied, add notices identifying the source, revision, files and changes first. |

This was public documentation/source inspection, not inspection of the user's account or a successful inference test. No model request, installation, subscription or account change was made. Neither service's third-party OAuth/device login support has been established by the inspected sources.

## Existing METE support and gaps

- `packages/providers/src/providers/custom.ts` already registers `custom:<slug>` adapters, streams OpenAI chat, reads secret keys and observes HTTP 429 with `Retry-After`.
- `packages/contracts/src/domain/provider.ts` already accepts a custom endpoint's slug, name, URL, format and headers. No router names need to enter core or team templates.
- `packages/ui-theia/src/infrastructure/endpoints-form.ts` already edits endpoints on a user's Save; key and Test actions exist.
- OpenAI custom model discovery currently reads IDs only. Context, tools and vision remain unknown without `models:` rows, so discovery alone does not make these routes usable by the tier selector.
- `ModelRowSchema` already supports exact model IDs, capability, context, tools, vision, free/paid status, family, privacy, source and verification date.
- Gateway discovery caches successful lists for the daemon lifetime (`packages/gateway/src/application/prepare.ts`). Account connection and model refresh therefore need an explicit lifecycle design; restarting the IDE or manually applying settings is not an acceptable primary connection flow. Any new invalidation API or refresh default needs specification before implementation.
- ADR-088's Welcome screen counts built-in keys only. A custom-only installation needs an explicit onboarding decision rather than being reported as fully supported by the existing Welcome screen.

## Proposed design

### Account-first connection experience

The normal flow is **Models and accounts → choose service → connect → choose an available model → use it in a run**. OmniRoute and FreeLLMAPI are recognizable connection cards, not empty custom-endpoint forms.

If the service officially supports third-party OAuth or device authorization, use that documented flow in the system browser. Do not invent authorization URLs, reuse browser cookies, collect account passwords or impersonate another IDE. A website's own login is not necessarily a supported external-client login.

If API-key access is the supported connection, show one screen for the inference key and, only when account-specific, the API address. Supply a default address only when official evidence establishes it for that account type. Keep format, slug, headers and raw configuration out of the normal flow; advanced custom-endpoint setup remains optional.

A single Connect action validates the connection without making an inference request, stores credentials securely and loads the account's accessible models. It must not interrupt running work: if activation cannot safely happen now, show the reason and a clear deferred action rather than silently restarting a daemon. The lifecycle mechanism is a design/ADR gate, not an assumed existing feature.

Use the existing custom transport, keychain and gateway wherever they satisfy the verified service API. Provider-specific authentication and metadata belong in adapters; core and team templates remain provider-agnostic. No new runtime dependency or bundled router is proposed. Users may optionally connect an existing local router, but that is not a prerequisite imposed by METE.

If an account's subscription does not provide inference access, explain that before presenting a success state. A catalog subscription must not be presented as a working model account. Obtaining the actual account connection method is the current evidence gate.

### Model discovery and selection

Extend the generic custom OpenAI model reader, with Zod validation at the HTTP boundary, to retain verified metadata instead of discarding it. Recognize the documented context and tool fields and add only verified vision-field mappings. Preserve exact IDs, including provider-qualified names.

Show the account's models with explicit states: available, quota exhausted, unavailable, or awaiting metadata verification. Do not advertise a global catalog as the user's entitlement. Keep temporarily exhausted entries visible with their known reset information; do not use a ready-only response as a lifetime catalog cache. Add a Refresh models action and specify how refreshed data reaches gateway selection without restarting the IDE.

Populate context, tools, vision and price from supported service metadata, supplemented only by verified integration data with source and date. Do not infer a zero price from a brand, a missing field or an undocumented naming convention. Unknown price is displayed as unknown, not free, and is not silently admitted into free mode. Existing optional user overrides remain compatible, but editing them is not required by the connection workflow.

Do not ask users to enter model IDs, families, context windows, capabilities or model rows. If public/account APIs cannot establish a fact necessary for safe use, keep that model visibly unverified and resolve the integration gap before calling the service supported. The Test action is explicit and explains that it sends a real request and may consume quota; discovery does not probe models automatically.

List virtual routes only when the integration establishes their capabilities, permitted destinations and billing semantics. Do not preselect an unverified `auto`, named chain, alias or `fusion` route. A capability and privacy claim must hold across every possible destination, not just the requested name. Do not require users to become routing experts to compensate for an incomplete adapter.

Unknown privacy stays unknown. Existing ADR-021 handling applies; connection setup does not silently enable training or claim that a loopback URL makes upstream processing private. Show why a listed model is excluded by the current mode, capability requirements or privacy settings.

### Accounting and failure behavior

Use existing custom-endpoint quota units: account-scoped `requests_per_minute`, initially `discover`, learned through 429 and `Retry-After`. Track requests METE sends to each router. The router manages its upstream pools; METE must not claim those pools are separate from directly connected accounts or that its request count includes invisible upstream retries.

Keep the existing contracts for invalid key, unavailable endpoint, malformed model list, timeout, cancellation, streamed error and quota exhaustion. Streamed text/tool calls and usage use the existing OpenAI chat implementation. Any incompatibility discovered in fixtures is fixed there with a focused regression test, not with a second chat stack.

The displayed provider/model identify the requested router route. An underlying model header must not be represented as a persisted actual-provider fact until a separate contract proposal covers it. `fusion` is not part of the initial supported setup because one request intentionally fans out to multiple model calls.

## Implementation slices

One slice is one package and one concern, roughly 300 changed lines maximum. Split further if tests or UI make a slice larger. Each slice starts with tests and ends with `pnpm check`.

1. **Resolve the account evidence gate.** Establish the account type, official external-client authentication, inference endpoint, model entitlement API and price/privacy metadata for each service. A redacted account connection page can identify the correct documentation; do not request credentials in chat. Stop and report any unavailable integration instead of inventing it.
2. **Approve specification and ADR.** Specify the verified authentication, metadata resolution, account connection lifecycle, manual model refresh, route identity/accounting and custom-only onboarding. Update docs/09 and docs/13 and add a Phase 5 roadmap link after approval. Do not change accepted ADRs implicitly.
3. **Boundary contracts, only if needed.** Identify missing data/actions in existing capability and daemon protocols. Any needed change gets its own `@mete/contracts` slice, required capability/protocol version updates and contract tests before consumers change. Do not let the UI import a capability module's internal schema.
4. **`@mete/providers`: one service adapter slice at a time.** Reuse the generic OpenAI transport. Parse account-scoped catalogs and verified facts; test auth failure, incomplete metadata, unavailable/exhausted states and malformed responses with hand-written fetch fakes. Preserve existing plain-custom endpoint behavior. Add a changeset for each user-visible slice.
5. **`@mete/gateway`: catalog refresh, if required by the approved design.** Implement the specified invalidation without inventing refresh intervals or disturbing in-flight calls. Prove temporarily exhausted routes can return and disconnected accounts stop being offered.
6. **`@mete/cli`: account lifecycle and composition.** Implement only the approved daemon connection/refresh actions. Add offline HTTP fixtures proving selected-route eligibility, streamed tool invocation, cancellation, expired credentials and 429 handling. Split lifecycle implementation from composition tests where needed.
7. **`@mete/ui-theia`: account cards and model picker.** Build the guided connection, state/error messages, explicit Test, Refresh models, reconnect/disconnect and model selection. No slug, format or YAML in the normal flow. Save only through user actions. Deliver connection flow, refresh/status and custom-only Welcome support as separate small slices, with English/Turkish strings and changesets.
8. **`@mete/desktop`: acceptance.** Offline Electron scenarios connect each service fixture, select an account-available model, complete a task, refresh a changed catalog and reconnect after expiry. Verify no configuration-file editing or local server installation is needed, credentials persist securely, and running work is not silently interrupted.
9. **Live account acceptance.** After explicit user consent, validate against the user's actual supported connection with credentials entered through the application, not chat. Report which account routes were tested and any gaps separately from offline evidence. Run `pnpm check` after every implementation slice.

## Acceptance criteria

- An existing account can be connected through its verified external-client mechanism from a recognizable service card.
- Normal use requires no YAML, manual model rows, technical slugs, IDE restart or mandatory local router installation.
- Their selected, qualified free chat routes appear in the existing model picker and serve a task through METE's gateway.
- The account's available models load automatically; Refresh models works without restarting the IDE. Unknown or paid models are not silently admitted into free mode; incomplete integration metadata is not made the user's configuration homework.
- Tools and context limits reflect supplied evidence; no blanket `toolCalling: true` or invented context window.
- A temporarily exhausted route can return after reset; expired login, missing API entitlement or an unreachable service has an actionable message and does not break other providers.
- No secret is written to YAML, logs, test snapshots or plan files.
- Custom-only onboarding works; existing built-in providers and plain custom endpoints keep their behavior.
- All automated tests are offline, and `pnpm check` passes after each implementation slice.

## Decisions/input still needed

1. Which external-client connection the user's account actually exposes: official sign-in/device authorization, or an inference API key and account-provided API address. A redacted connection-page screenshot or documentation link is enough to identify this; no secret is needed in chat.
2. Verified entitlement, price, privacy and routing behavior for that account API. Public marketing membership claims and a global catalog do not establish these.
3. Approval of the revised multi-package design after the evidence gate, as AGENTS.md requires. The user approved the desired easy account-first experience, not a particular unverified implementation.

## Sources

1. OmniRoute deployment overview: https://www.omniroute.online/tr/
2. OmniRoute OpenAI compatibility (release/v3.8.54): https://github.com/cheaper-inference/OmniRoute/blob/release/v3.8.54/docs/reference/OPENAI_COMPATIBILITY.md
3. FreeLLMAPI product and pricing: https://freellmapi.co/
4. FreeLLMAPI REST API: https://github.com/tashfeenahmed/freellmapi/blob/main/docs/en/api/01-rest-api.md
5. FreeLLMAPI listing and request routing: https://github.com/tashfeenahmed/freellmapi/blob/main/server/src/routes/proxy.ts and https://github.com/tashfeenahmed/freellmapi/blob/main/server/src/services/model-listing.ts
6. OmniRoute free-tier evidence and caveats: https://github.com/cheaper-inference/OmniRoute/blob/release/v3.8.54/docs/reference/FREE_TIERS.md
7. OmniRoute license: https://github.com/cheaper-inference/OmniRoute/blob/release/v3.8.54/LICENSE
8. FreeLLMAPI license: https://github.com/tashfeenahmed/freellmapi/blob/main/LICENSE
9. OmniRoute Cloud hosting terms (2026-10-29): https://www.omniroute.online/cloud/terms/
10. FreeLLMAPI's published key/connection guide: https://freellmapi.co/how-to-get-a-free-llm-api-key

All sources inspected on 2026-11-06. Mutable upstream pages can change; record the exact revision with implementation fixtures.
