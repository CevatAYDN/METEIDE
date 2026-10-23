// Named defaults for this package; each names the document tab that defines it (CONTRIBUTING.md).
import type { QuotaUnitSpec } from "@mete/contracts";

/** OpenCode Zen chat and model list endpoints (09 Provider adapter, provider facts). */
export const ZEN_BASE_URL = "https://opencode.ai/inference/openai/v1";
export const ZEN_MODELS_URL = "https://opencode.ai/inference/v1/models";

/** OpenCode Zen limits are learned from 429 responses (09 Quota pool). */
export const ZEN_QUOTA: readonly QuotaUnitSpec[] = [
	{
		providerId: "opencode-zen",
		unit: "requests_per_minute",
		limit: "discover",
		scope: "account",
		reset: "sliding",
	},
];

/** Groq's OpenAI-compatible chat and model list endpoints (09 Provider adapter, provider facts). */
export const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
export const GROQ_MODELS_URL = "https://api.groq.com/openai/v1/models";

/** Google AI Studio's OpenAI-compatible chat and model list endpoints (09 Provider adapter, provider facts). */
export const GOOGLE_BASE_URL =
	"https://generativelanguage.googleapis.com/v1beta/openai";
export const GOOGLE_MODELS_URL =
	"https://generativelanguage.googleapis.com/v1beta/openai/models";

/** OpenRouter's API (09 Provider adapter, provider facts). */
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** OpenRouter free-model limits: 20 a minute, 50 a UTC day before credits (09 Quota pool). */
export const OPENROUTER_QUOTA: readonly QuotaUnitSpec[] = [
	{
		providerId: "openrouter",
		unit: "requests_per_minute",
		limit: 20,
		scope: "account",
		reset: "sliding",
	},
	{
		providerId: "openrouter",
		unit: "requests_per_day",
		limit: 50,
		scope: "account",
		reset: "fixed_daily",
	},
];

/** A rate limit of this size or more is OpenRouter's daily one (09 observe() rules). */
export const OPENROUTER_DAILY_LIMIT_FLOOR = 50;

/** NVIDIA Build endpoints (09 Provider adapter, provider facts). */
export const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
export const NVIDIA_RERANK_URL = (model: string) =>
	`https://ai.api.nvidia.com/v1/retrieval/${model}/reranking`;

/** NVIDIA Build's documented starting limit: 40 requests a minute (09 Quota pool). */
export const NVIDIA_QUOTA: readonly QuotaUnitSpec[] = [
	{
		providerId: "nvidia",
		unit: "requests_per_minute",
		limit: 40,
		scope: "account",
		reset: "sliding",
	},
];

/** The header of a refused Groq request that names its tokens-per-minute limit (09 observe() rules; ADR-056). */
export const GROQ_TOKEN_LIMIT_HEADER = "x-ratelimit-limit-tokens";

/** A tokens-per-minute limit per model, learned from a refused request (09 Quota pool, starting values; ADR-056). */
export const tokenQuota = (providerId: string): QuotaUnitSpec => ({
	providerId,
	unit: "tokens_per_minute",
	limit: "discover",
	scope: "model",
	reset: "sliding",
});

/** A custom endpoint's limit is learned from 429 responses, like OpenCode Zen's (09 API keys). */
export const customQuota = (providerId: string): QuotaUnitSpec[] => [
	{
		providerId,
		unit: "requests_per_minute",
		limit: "discover",
		scope: "account",
		reset: "sliding",
	},
];
