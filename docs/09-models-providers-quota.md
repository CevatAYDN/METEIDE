# 09 Models, providers and quota

Repository file: `docs/09-models-providers-quota.md`. Depends on: 06 Kernel and modules, 07 Domain model and events.

Templates ask for a tier, the router picks a free model for it at runtime, and every call passes the local gateway, where privacy, masking and quota are enforced.

## Provider adapter

```ts
interface ProviderAdapter {
  readonly id: string;                         // "nvidia" | "openrouter" | "opencode-zen" | "custom:<slug>"
  readonly format: "openai-chat" | "anthropic-messages" | "google-gemini";
  listModels(signal: AbortSignal): Promise<Result<ModelInfo[], ProviderError>>;
  chat(req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatChunk>;
  embed?(req: EmbedRequest, signal: AbortSignal): Promise<Result<EmbedResponse, ProviderError>>;
  rerank?(req: RerankRequest, signal: AbortSignal): Promise<Result<RerankResponse, ProviderError>>;
  quotaUnits(): QuotaUnitSpec[];
  observe(status: number, headers: Headers): QuotaObservation[];   // reads rate-limit headers and 429s
  privacy(model: ModelInfo): { trains: boolean | "unknown"; logs: boolean | "unknown"; publishes: boolean | "unknown" };
}

interface ModelInfo { id: string; providerId: string; family: string; contextWindow: number;
  toolCalling: boolean | "unknown"; vision: boolean | "unknown"; free: boolean; deprecated: boolean;
  price?: { input: number; output: number } }   // provider.chat@2: US dollars per million tokens, paid models only
```

Custom endpoints are created from a form: name, base URL, API key, extra headers, format. On save METE calls `GET <base>/models` and fills `ModelInfo` from the returned metadata. Unknown capabilities stay `"unknown"`; the "Test" button sends one probe call per selected model, only when the user presses it \[D\].

The shapes `chat`, `embed` and `rerank` use are in tab 06. `chat` streams chunks and ends with exactly one `finish` or one `error` chunk; it never throws for a provider failure, and the gateway passes an `error` chunk's status and headers to `observe()`. Each provider module provides its one adapter object under every capability its row in tab 06 lists \[D\].

`GET <base>/models` from NVIDIA and OpenCode Zen returns model ids only, so `@mete/providers` ships `models.yaml` beside `tiers.yaml`: per provider, exact model ids with `capability` (`chat`, `embed` or `rerank`), `contextWindow`, `toolCalling`, `vision`, `free`, `family` and, where a provider's privacy differs per model, `privacy`. Like `tiers.yaml` it is data the user and the community edit \[D\]:

- A model the provider lists with neither metadata nor a row gets `contextWindow: 0` and `free: false`, so it fits no tier.
- A `chat` or `embed` row whose id the provider no longer lists is not offered. NVIDIA lists no rerank models, so `rerank` rows are offered as shipped.
- `deprecated` comes only from provider metadata.
- Ids are exact, never patterns; a new free model needs a new row.
- Discovery sends no probe calls.
- The shipped `models.yaml` and `tiers.yaml` live in `packages/providers/data/` and are read at runtime. `models.yaml` is keyed by provider and then exact model id, so the user's rows in the `models:` section of `settings.yaml` (or `.mete/models.yaml`) merge the usual way (ARCHITECTURE.md, Configuration): a row with a shipped id replaces it, any other id is added. The user's `tiers.yaml` rows go in the `tiers:` section the same way; its shape is set with the router.
- Each shipped row names its source and the date it was checked; facts not in the provider's own documentation come from models.dev (MIT, THIRD_PARTY_NOTICES.md).

API keys live in the operating system keychain through `ModuleContext.secrets` (tab 06), which the composition root builds from the keychain store in `@mete/security` on `@napi-rs/keyring`; it is not a capability. Keys are kept under service `mete` and account `providers/<providerId>/apiKey`, or `providers/custom:<slug>/apiKey` for a custom endpoint. A provider module whose key is missing fails activation with "no API key" and stays inactive until the user adds one. Provider modules declare the `net` and `secrets` permissions. Custom endpoints are kept in the `providers:` section of `settings.yaml` as `custom: [{ slug, name, baseUrl, format, headers }]`; their keys never go into a file. The `provider-custom` module provides one adapter per endpoint, registered as `custom:<slug>`: an endpoint without its key is skipped with a warning while the others activate, no endpoints means the module activates and provides nothing, and only `openai-chat` endpoints provide `provider.embed@1`. Each custom endpoint has one quota unit, `requests_per_minute` with limit `discover` and account scope, which a 429 closes like OpenCode Zen's; its privacy comes from the `models:` rows under provider id `custom:<slug>` and is unknown otherwise \[D\].

Provider facts, checked on 2026-10-21 against each provider's documentation \[D\]:

| Provider | Chat endpoint | Model list | Free models | Limit signals | Privacy |
| --- | --- | --- | --- | --- | --- |
| NVIDIA Build | `https://integrate.api.nvidia.com/v1`, `openai-chat` | `/models`: ids only, chat, embedding and rerank models together; `models.yaml` rows decide which model serves which capability | Every model with a row (trial access) | No rate-limit headers documented; a 429, with `Retry-After` when present | `trains: true`, `logs: true`, `publishes: false`: the NVIDIA API Trial Terms of Service, section 3.3 (iv), collect user and generated content "to improve NVIDIA products and services, including AI models" |
| OpenRouter | `https://openrouter.ai/api/v1`, `openai-chat`, with `provider: { data_collection: "deny" }` unless the user opted in | `/models` with metadata: `context_length`, `supported_parameters` (`tools`), input modalities, `pricing`, `expiration_date` | Ids ending `:free` | Successful responses carry no rate-limit headers. A 429 from OpenRouter's own limits carries `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset`, plus `Retry-After` when every provider gave one; a 429 from an upstream provider carries `error.metadata.provider_code` instead. A limit hit while streaming arrives as an event with `finish_reason: "error"`. Free-model daily limits count per UTC day | With `data_collection: "deny"`: `trains: false`, `publishes: false`, `logs: "unknown"`; a `:free` model that only collecting providers serve then fails at request time |
| OpenCode Zen | `https://opencode.ai/inference/openai/v1`, `openai-chat` (most free models) | `https://opencode.ai/inference/v1/models`: ids only | The `-free` ids and `big-pickle`, as rows in `models.yaml` | Not documented; limits are `discover` (Quota pool) | Per model: Big Pickle, Exo Free, the MiMo free models and LL Alpha Free may be used to improve the model; the Nemotron free models are logged for NVIDIA's improvement (`trains: true` for all of these); Beam Free is kept 30 days and not trained on; the rest keep no data. On 2026-10-22 every free model answered 403 `FreeTierError` ("OpenCode's free tier can only be used from within OpenCode") to METE's calls with a valid key; paid Zen models are not tested yet (ADR-043) |

`observe()` rules \[D\]:

- OpenRouter: only a 429 that carries `X-RateLimit-*` headers is an exhausted observation, for `requests_per_day` when `X-RateLimit-Limit` is 50 or more (the documented daily limits are 50 and 1,000) and `requests_per_minute` otherwise (documented as 20); an upstream 429 closes nothing. `X-RateLimit-Reset` is not read, because its unit is not documented; `Retry-After` gives `resetsAt`. A limit hit while streaming carries no headers and closes nothing; the next request's 429 does.
- NVIDIA and OpenCode Zen: a 429 is an exhausted observation for `requests_per_minute`, with `resetsAt` from `Retry-After` when present.
- `Retry-After` counts only as whole delay seconds or an HTTP date that lies in the future and within the range of a date; a decimal or signed value, a past date or a larger value gives no `resetsAt`, so the caller backs off instead of retrying at once.
- An error a provider sends inside the stream (`{"error": {"message", "code"}}`) maps like an HTTP status when `code` is a number (429 `rate_limited`, 5xx `server`), and to `server` otherwise; it carries no `status`, so it closes no quota unit.
- Custom endpoints list models with `GET <baseUrl>/models`, first page only: `openai-chat` with `Authorization: Bearer`, ids only; `anthropic-messages` with `x-api-key` and `anthropic-version: 2023-06-01` and `?limit=1000`, where `max_input_tokens` is the context window, `capabilities.image_input.supported` is vision and a `lifecycle` other than `active` is deprecated; `google-gemini` with `x-goog-api-key` and `?pageSize=1000`, where `name` without its `models/` prefix is the id, `inputTokenLimit` is the context window and only models whose `supportedGenerationMethods` include `generateContent` are listed. Tool calling the lists do not state stays `unknown` (Anthropic and Google API references, checked on 2026-10-21).
- NVIDIA embeddings use `POST https://integrate.api.nvidia.com/v1/embeddings` with `input_type: "query"` or `"passage"` (an embed request's `purpose` of `query` or `document`); rerank uses `POST https://ai.api.nvidia.com/v1/retrieval/<model id>/reranking` with `{ model, query: { text }, passages: [{ text }] }` and answers `{ rankings: [{ index, logit }] }`, highest first, which the adapter turns into one score per document in input order (NVIDIA API reference, checked on 2026-10-21).

## Model tiers

| Tier | Used for | Hard requirements |
| --- | --- | --- |
| `reasoning` | Design, planning, review, approval | Context window of 32k tokens or more \[D\] |
| `coder` | Code and file edits | Tool calling; context of 32k or more \[C\] |
| `fast` | Routing, summaries, context compaction | Context of 8k or more \[D\] |
| `long-context` | Large documents and repository analysis | Context of 128k or more \[D\] |
| `vision` | Screenshots, image review, asset work | Image input \[C\] |

Embedding and reranking are provider capabilities (`provider.embed@1`, `provider.rerank@1`), not tiers. Image and 3D generation are `media.*` capabilities served through MCP (ADR-030).

## Tier resolution

1. Candidates: discovered models that the model mode allows (free models only by default, see Model mode and spending), are not deprecated, meet the tier requirements and the role's `needs`, and pass the privacy policy.
2. Order: learned score when the model has 5 or more samples for this role and task kind; otherwise the community priority list `tiers.yaml` shipped in `@mete/providers`; then larger context window first \[D\].
3. Apply `prefer_different_family_than`.
4. The chain is every candidate in that order. Quota reserves the first one whose provider is open, so the models of a closed provider are skipped, and a call tries at most 4 models; a model that refused the key does not count toward the 4 \[D\]. The agent uses the first; failures move down the chain and publish `agent.model.changed`.

`tiers.yaml` maps model id patterns to tiers per provider. It is data, editable by the user and the community; templates never reference it.

A requirement or a role's need is met only by a known value: `toolCalling: true` for `tool_calling`, `vision: true` for `vision` and image input, a context of 128k or more for `long_context`; `"unknown"` meets none of them. `avoidFamilies` drops candidates of those families when others remain. Until the learning router exists (core-engine), the order is context window only, larger first; learned scores and `tiers.yaml` come with the router \[D\].

## Model mode and spending

From Phase 2 the gateway is a router over free and paid models, so work does not stop when the free limits run out (ADR-042) \[D\]:

- The `gateway:` section of the settings holds `models: free | paid | both` (default `free`) and `dailySpendUsd` (default 1); like any section it can also come from the workspace as `.mete/gateway.yaml`.
- `free` keeps the candidates of Tier resolution as they are. `paid` admits only paid models. `both` puts the free candidates first, in their usual order, and the paid candidates after them, in the same order; a run pauses only when every candidate is closed by quota, refused or capped.
- A paid model is a discovered model with a known price: OpenRouter's `/models` gives `pricing` per model, and `models.yaml` rows give `price` for NVIDIA, OpenCode Zen and custom endpoints. A model without a price is never a paid candidate, as a model without a `free: true` row is never a free one. OpenRouter's `pricing.prompt` and `pricing.completion` are US dollars per token as decimal strings; they become `price = { input, output }` per million tokens, a `:free` model or a price of 0 or one that does not parse gets none, and a `models.yaml` row's `price: { input, output }` (same unit) wins over the listing [D].
- A unit spec with `providerId: "*"` (`ANY_PROVIDER` in `@mete/contracts`) spans every provider, but it counts only for calls whose amounts name its unit, so a free call never waits for the spending cap. A chain entry of `quota.reserve@2` may carry its own `estimate`, which goes over the request's for that entry: a paid model's cost depends on its price [D].
- Spending is METE's own quota unit `usd_per_day`, account-wide over every provider, with the limit `dailySpendUsd` and a fixed reset at 00:00 UTC. A paid call reserves its estimated cost (the token estimate of Gateway times the price) and settles the cost of its reported usage. The estimate prices the prompt tokens of the token estimate at the input price and `maxTokens` (0 when not set) at the output price; the settled cost prices the reported prompt and completion tokens the same way, so a call without `maxTokens` reserves less than it may spend and the settle corrects the day's total. The gateway defines the cap as a `providerId: "*"` unit whenever it lists models [D]. At the cap, `both` goes on with free models only and `paid` pauses the run with reason `quota` until the reset.
- The privacy rules (Privacy, ADR-021) apply to paid models unchanged.
- Credits on an OpenRouter account also raise its `:free` daily limit from 50 to 1,000 (Quota pool); the pool learns that from the response headers.
- The contract changes land with the code: `provider.chat@2` adds the optional `ModelInfo.price` (US dollars per million input and output tokens) and `quota.reserve@2` adds the unit `usd_per_day`.

## Learning router

After every task attempt the router stores, per model, role and task kind: attempts, verify pass rate, average revisions, average requests and latency, in the global `mete.db` \[C\].

```latex
\text{score} = 0.60 \cdot \text{passRate} + 0.25 \cdot \left(1 - \frac{\text{avgRevisions}}{\text{revisionLimit}}\right) + 0.15 \cdot \left(1 - \text{normalizedRequests}\right)
```

With probability 0.05 the router tries an untested candidate instead of the best one, so new free models get a chance \[D\].

## Gateway

- Endpoints: `/v1/chat/completions`, `/v1/embeddings`, `/v1/rerank`, `/v1/models` \[D\]. `/v1/models` lists tier aliases (`mete/reasoning`, `mete/coder`, `mete/fast`, `mete/long-context`, `mete/vision`) and discovered models. `/v1/embeddings` and `/v1/rerank` come with the knowledge layer (tab 06, Module catalog).
- Request pipeline: session token → `llm` permission check → privacy filter → secret masking → quota reservation → provider call → quota observation → log.
- Errors: on 429 or 5xx, wait for the reset header if it is under 90 seconds, otherwise back off 2, 8 and 30 seconds; after 3 failures on one model, move to the next model in the chain \[D\]. Tight retry loops are forbidden \[C\].
- Retries in detail: the reset is the earliest `resetsAt` that `observe()` read from the failure. The back-off steps are used in order, so with 3 failures per model only 2 and 8 seconds are reached: the first failure waits 2 seconds (or the reset), the second 8, the third moves on at once. Any other `ProviderError` (`unauthorized`, `bad_request`, `network`) moves to the next model at once; `aborted` ends the call. A model that answered `unauthorized` (401 or 403) is also left out of every later call until the gateway restarts, and its status and message are logged at warn level, so a model the key may not use costs one call per process. A `bad_request` is not remembered, so the model is tried again at the next call, and every try costs a request on the provider's quota; its status and message are logged at warn level once per model and process, so the reason can be found \[D\]. Once a model has streamed a `text` or `tool-call` chunk, a failure ends the call with that error, since the caller already has the partial answer \[D\].
- Quota estimate: 1 request, and for `tokens_per_minute` the prompt characters (message text, tool calls and tool specs) divided by 4, rounded up, plus `maxTokens` when set; the finish chunk's usage settles the actual tokens \[D\].
- Logs: full prompts and responses go only into the workspace `mete.db` for replay. Global logs keep metadata only \[D\].
- `llm.chat@1` (tab 06): a `{ tier }` target resolves the chain above; a model target is a chain of that one model, which must be discovered, free, not deprecated and pass the privacy filter. Before the first chunk from a model the gateway streams a `model` chunk: reason `first` for the chain's first model, `quota` when the quota grant was for a later one, `failed` after moving down the chain. An empty chain ends with error `no_model`, except that an abort while the models are listed ends with `aborted`; a failed reservation ends with `quota_exhausted` and its `resumesAt`; otherwise the last error is the model's `ProviderError` \[D\].
- The HTTP endpoints are served by `serveGateway({ chat, models, token })` from `@mete/gateway`, which listens on 127.0.0.1 on a free port and returns `{ port, close }`. `createGatewayModule()` returns the module together with `models(signal)`, the discovered models that are free, not deprecated and pass the privacy filter, from the module's own discovery. The composition root generates the session token (32 random bytes, base64url) at start, calls `serveGateway`, and passes `METE_GATEWAY_URL` and `METE_GATEWAY_TOKEN` to child processes, with the run id; the module itself only provides the `llm.*` capabilities \[D\].
- HTTP mapping: every request carries `Authorization: Bearer <token>` (401 otherwise). `model` is `mete/<tier>` for a tier, otherwise `<providerId>/<modelId>` split at the first `/`; `/v1/models` lists both forms. `X-Mete-Run-Id` (a UUID) is required and `X-Mete-Priority` (0, 1 or 2) defaults to 1. Errors use the OpenAI body `{ error: { message, type, code } }`: 400 for an invalid body or a missing run id, 503 for `no_model`, 429 with `Retry-After` in seconds for `quota_exhausted`, 429 for `rate_limited`, 400 for `bad_request`, 502 for `unauthorized`, `server` and `network`. A failure after a stream has started is sent as an SSE `error` event followed by `data: [DONE]` \[D\].

## Privacy

- Models whose provider trains on or publishes prompts are excluded unless the user enables them in Settings, after a warning that explains the effect \[C\].
- OpenRouter requests carry the provider-routing preference `data_collection: "deny"` unless the user opted in with `allowTraining` in a workspace that is not `sensitive`; the provider modules read that at activation \[D\]. When that routing leaves a model no endpoint, OpenRouter answers `404 No endpoints found matching your data policy`; the adapter reports it as `unauthorized`, so the gateway leaves the model out for the process like one that refused the key, instead of paying a request for it on every call \[D\].
- A workspace marked `sensitive` uses only models with `trains: false` and `publishes: false`, and shows a banner that its content goes to cloud providers \[D\].
- A `trains` or `publishes` value of `"unknown"` counts as true. The Settings switch is `allowTraining` in the `privacy:` section (default `false`); when true it admits models that train on, publish or have unknown facts about prompts, except in a `sensitive` workspace. Like any section, `privacy:` can also come from the workspace as `.mete/privacy.yaml`, which turns the switch on for that workspace only. The gateway reads `sensitivity` (`normal` by default) from `.mete/workspace.yaml` \[D\].
- Secret masking runs secretlint rules on every outbound request and replaces matches with `[SECRET:<first 8 hex of sha256>]` \[C\].
- Files matched by `.meteignore` are never read into a prompt. Default `.meteignore`: `.env*`, `*.pem`, `*.key`, `id_rsa*`, `secrets/` \[D\].

## Quota pool

```ts
type QuotaUnit = "requests_per_minute" | "requests_per_day" | "tokens_per_minute" | "credits_per_month" | "gpu_seconds_per_day"
  | "usd_per_day";   // quota.reserve@2 (ADR-042): METE's own daily spending cap
interface QuotaUnitSpec { providerId: string; unit: QuotaUnit; limit: number | "discover";
  scope: "account" | "model"; reset: "sliding" | "fixed_daily" | "fixed_monthly" }
```

Provider adapters ship these starting values, checked on 2026-10-21. They are editable in Settings and are corrected automatically from response headers \[C\]:

| Provider | Unit | Starting value | Notes |
| --- | --- | --- | --- |
| OpenRouter `:free` models | requests\_per\_minute | 20 | Account-wide |
| OpenRouter `:free` models | requests\_per\_day | 50; 1,000 after a lifetime purchase of 10 credits | Account-wide across all free models; more accounts do not raise it |
| NVIDIA Build | requests\_per\_minute | 40 | The real value is shown in the user's NVIDIA dashboard |
| OpenCode Zen free models | requests\_per\_minute | discover | Learned from 429 responses |
| Paid models, every provider (ADR-042) | usd\_per\_day | 1 | METE's own spending cap from `gateway.dailySpendUsd`, not a provider limit; from Phase 2 |
| Hugging Face ZeroGPU | gpu\_seconds\_per\_day | 300 | About 5 minutes per day on a free account |
| Tavily | credits\_per\_month | 1,000 | No card required |
| Exa API | credits\_per\_month | 10 | US dollars of monthly free credit |
| You.com | requests\_per\_day | 100 | Free tier |
| Firecrawl | credits\_per\_month | 1,000 | About 500 searches |
| Exa MCP without key | requests\_per\_minute | discover | Learned from errors |

`quota.reserve@2` (types in tab 06) is the pool's only entry point; the gateway calls it around every provider call \[D\]:

- `define(specs)`: the gateway passes a provider adapter's `quotaUnits()` when it first resolves that provider; a later call for the same provider replaces its specs.
- `reserve(req, signal)`: walks `req.chain` in order and reserves the first entry whose provider has capacity in every unit (Scheduler, step 2). The estimate is 1 request plus the caller's amounts for the other units; a unit without an amount only needs to be open. A unit has capacity when its usage, plus unsettled reservations, plus the amount fits its limit. An entry whose amount for some unit is above that unit's limit can never fit and is skipped. An empty chain, an entry whose provider was never defined, or a chain where every entry was skipped is a programmer error and throws. When no entry has capacity and a reset comes within 90 seconds the call waits; otherwise, or once it has waited 90 seconds, it returns `quota_exhausted` with `resumesAt` set to the earliest reset. An aborted signal returns `aborted`.
- `settle(id, actual, observations)`: once per reservation, after the provider answered or failed. It replaces the reserved amounts with `actual`, where a request unit `actual` leaves out counts 1, as in `reserve`; `actual: null` means no call was sent and releases the reservation. It then applies the observations and publishes `quota.consumed` for each defined unit with an amount above 0; amounts for units the provider did not define are dropped. The gateway MUST settle every reservation; an unsettled one keeps its capacity. Settling an unknown or already settled id returns `unknown_reservation`.

Pool rules \[D\]:

- Windows: `sliding` counts the last minute, day or 30 days, as the unit name says; `fixed_daily` resets at 00:00 UTC and `fixed_monthly` on the 1st at 00:00 UTC. A `resetsAt` read from a response replaces the computed reset. The reset of a sliding window is the moment enough of its oldest amounts leave the window for the waiting amount to fit.
- A unit with `scope: "model"` is counted per model id, an `account` unit once per provider.
- The effective limit, first match wins: the user's `quota` configuration (`limits: [{ providerId, unit, limit }]`, each provider unit at most once, in the `quota:` section of `settings.yaml`; the pool is shared by all workspaces, so a `.mete/quota.yaml` changes it for every workspace while that one is open), the last `limit` read from a response, a discovered limit, the shipped value. A `remaining` read from a response sets the window's usage to limit minus remaining.
- `limit: "discover"` means no limit until the first exhausted observation; the limit then becomes the usage in the current window without the refused call that brought the observation, at least 1.
- An exhausted observation counts as `remaining: 0`, so the window's usage becomes the limit.
- A unit is closed while its usage is at or above the limit, or until the `resetsAt` of an exhausted observation when one was given; otherwise it opens when its window resets. Closing publishes `quota.exhausted`; opening again publishes `quota.restored`.
- Usage of day and month units and learned limits live in the global `mete.db` (`quota_usage`, `quota_limits`), so a restart keeps them; minute units are counted in memory.
- Quota does not pause runs: the core publishes `run.paused` with the returned `resumesAt` (tab 07), and budgets (Scheduler, step 5) are the core's.

## Scheduler

1. Priority classes: P0 interactive (the user is waiting), P1 foreground runs, P2 scheduled or triggered runs. Higher classes go first; runs in the same class share capacity round-robin \[C\]. Waiting calls are served P0 first; within a class the scheduler serves one call per run in turn. A waiting call claims every provider in its chain that could serve it; a call served later in that order takes no capacity from a claimed provider, but may use any other provider in its chain \[D\]. A call blocked only by unsettled reservations or by claims waits; after 90 seconds it returns `quota_exhausted` with `resumesAt` set to the earliest known reset, or to now when none is known \[D\].
2. Before each call the scheduler picks the first model in the chain whose provider has capacity in every unit, using prompt tokens plus `max_tokens` as the estimate, and reserves it. The response reconciles the reservation.
3. No capacity anywhere: wait if a reset comes within 90 seconds; otherwise pause the run with reason `quota` and `resumesAt` set to the earliest reset \[D\].
4. `media.*` calls are charged to their own provider units, separate from chat \[C\].
5. When a run reaches `budget.cloud_requests` or `budget.max_hours`, it pauses with reason `budget` and asks the user \[C\].
6. Before a run starts, the UI shows an estimate: the sum of historical average requests per role and task kind; without history, 12 requests per task, 4 per review and 3 per approval \[D\].
