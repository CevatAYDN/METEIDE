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
