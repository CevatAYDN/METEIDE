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
  toolCalling: boolean | "unknown"; vision: boolean | "unknown"; free: boolean; deprecated: boolean }
```

Custom endpoints are created from a form: name, base URL, API key, extra headers, format. On save METE calls `GET <base>/models` and fills `ModelInfo` from the returned metadata. Unknown capabilities stay `"unknown"`; the "Test" button sends one probe call per selected model, only when the user presses it \[D\].

The shapes `chat`, `embed` and `rerank` use are in tab 06. `chat` streams chunks and ends with exactly one `finish` or one `error` chunk; it never throws for a provider failure, and the gateway passes an `error` chunk's status and headers to `observe()`. Each provider module provides its one adapter object under every capability its row in tab 06 lists \[D\].

`GET <base>/models` from NVIDIA and OpenCode Zen returns model ids only, so `@mete/providers` ships `models.yaml` beside `tiers.yaml`: per provider, exact model ids with `capability` (`chat`, `embed` or `rerank`), `contextWindow`, `toolCalling`, `vision`, `free`, `family` and, where a provider's privacy differs per model, `privacy`. Like `tiers.yaml` it is data the user and the community edit \[D\]:

- A model the provider lists with neither metadata nor a row gets `contextWindow: 0` and `free: false`, so it fits no tier.
- A row whose id the provider no longer lists is not offered.
- `deprecated` comes only from provider metadata.
- Ids are exact, never patterns; a new free model needs a new row.
- Discovery sends no probe calls.

API keys live in the operating system keychain through `ModuleContext.secrets` (tab 06), which the composition root builds from the keychain store in `@mete/security` on `@napi-rs/keyring`; it is not a capability. Keys are kept under service `mete` and account `providers/<providerId>/apiKey`, or `providers/custom:<slug>/apiKey` for a custom endpoint. A provider module whose key is missing fails activation with "no API key" and stays inactive until the user adds one. Provider modules declare the `net` and `secrets` permissions. Custom endpoints are kept in the `providers:` section of `settings.yaml` as `custom: [{ slug, name, baseUrl, format, headers }]`; their keys never go into a file \[D\].

Provider facts, checked on 2026-10-21 against each provider's documentation \[D\]:

| Provider | Chat endpoint | Model list | Free models | Limit signals | Privacy |
| --- | --- | --- | --- | --- | --- |
| NVIDIA Build | `https://integrate.api.nvidia.com/v1`, `openai-chat` | `/models`: ids only, chat, embedding and rerank models together; `models.yaml` rows decide which model serves which capability | Every model with a row (trial access) | No rate-limit headers documented; a 429, with `Retry-After` when present | `trains: true`, `logs: true`, `publishes: false`: the NVIDIA API Trial Terms of Service, section 3.3 (iv), collect user and generated content "to improve NVIDIA products and services, including AI models" |
| OpenRouter | `https://openrouter.ai/api/v1`, `openai-chat`, with `provider: { data_collection: "deny" }` unless the user opted in | `/models` with metadata: `context_length`, `supported_parameters` (`tools`), input modalities, `pricing`, `expiration_date` | Ids ending `:free` | Successful responses carry no rate-limit headers. A 429 from OpenRouter's own limits carries `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset`, plus `Retry-After` when every provider gave one; a 429 from an upstream provider carries `error.metadata.provider_code` instead. A limit hit while streaming arrives as an event with `finish_reason: "error"`. Free-model daily limits count per UTC day | With `data_collection: "deny"`: `trains: false`, `publishes: false`, `logs: "unknown"`; a `:free` model that only collecting providers serve then fails at request time |
| OpenCode Zen | `https://opencode.ai/inference/openai/v1`, `openai-chat` (most free models) | `https://opencode.ai/inference/v1/models`: ids only | The `-free` ids and `big-pickle`, as rows in `models.yaml` | Not documented; limits are `discover` (Quota pool) | Per model: Big Pickle, Exo Free, the MiMo free models and LL Alpha Free may be used to improve the model; the Nemotron free models are logged for NVIDIA's improvement (`trains: true` for all of these); Beam Free is kept 30 days and not trained on; the rest keep no data |

`observe()` rules \[D\]:

- OpenRouter: only a 429 that carries `X-RateLimit-*` headers is an exhausted observation, for `requests_per_day` when `X-RateLimit-Limit` is 50 or more (the documented daily limits are 50 and 1,000) and `requests_per_minute` otherwise (documented as 20); an upstream 429 closes nothing. `X-RateLimit-Reset` is not read, because its unit is not documented; `Retry-After` gives `resetsAt`. A limit hit while streaming carries no headers and closes nothing; the next request's 429 does.
- NVIDIA and OpenCode Zen: a 429 is an exhausted observation for `requests_per_minute`, with `resetsAt` from `Retry-After` when present.
- NVIDIA's embedding and rerank endpoints are recorded here with the NVIDIA adapter.

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

1. Candidates: discovered models that are free, not deprecated, meet the tier requirements and the role's `needs`, and pass the privacy policy.
2. Order: learned score when the model has 5 or more samples for this role and task kind; otherwise the community priority list `tiers.yaml` shipped in `@mete/providers`; then larger context window first \[D\].
3. Apply `prefer_different_family_than`.
4. The chain is the first 4 candidates \[D\]. The agent uses the first; failures move down the chain and publish `agent.model.changed`.

`tiers.yaml` maps model id patterns to tiers per provider. It is data, editable by the user and the community; templates never reference it.

## Learning router

After every task attempt the router stores, per model, role and task kind: attempts, verify pass rate, average revisions, average requests and latency, in the global `mete.db` \[C\].

```latex
\text{score} = 0.60 \cdot \text{passRate} + 0.25 \cdot \left(1 - \frac{\text{avgRevisions}}{\text{revisionLimit}}\right) + 0.15 \cdot \left(1 - \text{normalizedRequests}\right)
```

With probability 0.05 the router tries an untested candidate instead of the best one, so new free models get a chance \[D\].

## Gateway

- Endpoints: `/v1/chat/completions`, `/v1/embeddings`, `/v1/rerank`, `/v1/models` \[D\]. `/v1/models` lists tier aliases (`mete/reasoning`, `mete/coder`, `mete/fast`, `mete/long-context`, `mete/vision`) and discovered models.
- Request pipeline: session token → `llm` permission check → privacy filter → secret masking → quota reservation → provider call → quota observation → log.
- Errors: on 429 or 5xx, wait for the reset header if it is under 90 seconds, otherwise back off 2, 8 and 30 seconds; after 3 failures on one model, move to the next model in the chain \[D\]. Tight retry loops are forbidden \[C\].
- Logs: full prompts and responses go only into the workspace `mete.db` for replay. Global logs keep metadata only \[D\].

## Privacy

- Models whose provider trains on or publishes prompts are excluded unless the user enables them in Settings, after a warning that explains the effect \[C\].
- OpenRouter requests carry the provider-routing preference `data_collection: "deny"` unless the user opted in \[D\].
- A workspace marked `sensitive` uses only models with `trains: false` and `publishes: false`, and shows a banner that its content goes to cloud providers \[D\].
- Secret masking runs secretlint rules on every outbound request and replaces matches with `[SECRET:<first 8 hex of sha256>]` \[C\].
- Files matched by `.meteignore` are never read into a prompt. Default `.meteignore`: `.env*`, `*.pem`, `*.key`, `id_rsa*`, `secrets/` \[D\].

## Quota pool

```ts
type QuotaUnit = "requests_per_minute" | "requests_per_day" | "tokens_per_minute" | "credits_per_month" | "gpu_seconds_per_day";
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
| Hugging Face ZeroGPU | gpu\_seconds\_per\_day | 300 | About 5 minutes per day on a free account |
| Tavily | credits\_per\_month | 1,000 | No card required |
| Exa API | credits\_per\_month | 10 | US dollars of monthly free credit |
| You.com | requests\_per\_day | 100 | Free tier |
| Firecrawl | credits\_per\_month | 1,000 | About 500 searches |
| Exa MCP without key | requests\_per\_minute | discover | Learned from errors |

`quota.reserve@1` (types in tab 06) is the pool's only entry point; the gateway calls it around every provider call \[D\]:

- `define(specs)`: the gateway passes a provider adapter's `quotaUnits()` when it first resolves that provider; a later call for the same provider replaces its specs.
- `reserve(req, signal)`: walks `req.chain` in order and reserves the first entry whose provider has capacity in every unit (Scheduler, step 2). The estimate is 1 request plus the caller's amounts for the other units; a unit without an amount only needs to be open. A unit has capacity when its usage, plus unsettled reservations, plus the amount fits its limit. An entry whose amount for some unit is above that unit's limit can never fit and is skipped. An empty chain, an entry whose provider was never defined, or a chain where every entry was skipped is a programmer error and throws. When no entry has capacity and a reset comes within 90 seconds the call waits; otherwise, or once it has waited 90 seconds, it returns `quota_exhausted` with `resumesAt` set to the earliest reset. An aborted signal returns `aborted`.
- `settle(id, actual, observations)`: once per reservation, after the provider answered or failed. It replaces the reserved amounts with `actual`, where a request unit `actual` leaves out counts 1, as in `reserve`; `actual: null` means no call was sent and releases the reservation. It then applies the observations and publishes `quota.consumed` for each defined unit with an amount above 0; amounts for units the provider did not define are dropped. The gateway MUST settle every reservation; an unsettled one keeps its capacity. Settling an unknown or already settled id returns `unknown_reservation`.

Pool rules \[D\]:

- Windows: `sliding` counts the last minute, day or 30 days, as the unit name says; `fixed_daily` resets at 00:00 UTC and `fixed_monthly` on the 1st at 00:00 UTC. A `resetsAt` read from a response replaces the computed reset. The reset of a sliding window is the moment enough of its oldest amounts leave the window for the waiting amount to fit.
- A unit with `scope: "model"` is counted per model id, an `account` unit once per provider.
- The effective limit, first match wins: the user's `quota` configuration (`limits: [{ providerId, unit, limit }]`, each provider unit at most once, in the `quota:` section of `settings.yaml`; the pool is shared by all workspaces, so a `.mete/quota.yaml` changes it for every workspace while that one is open), the last `limit` read from a response, a discovered limit, the shipped value. A `remaining` read from a response sets the window's usage to limit minus remaining.
- `limit: "discover"` means no limit until the first exhausted observation; the limit then becomes the usage in the current window, at least 1.
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
