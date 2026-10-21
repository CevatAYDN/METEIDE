// Named defaults for this package; each names the document tab that defines it (CONTRIBUTING.md).
import type { Tier } from "@mete/contracts";

/** Tier resolution: the chain is the first 4 candidates (tab 09, Tier resolution). */
export const CHAIN_LENGTH = 4;

/** Tab 09, Model tiers: minimum context window per tier, "k" read as 1000 tokens. */
export const TIER_MIN_CONTEXT: Readonly<Record<Tier, number>> = {
	reasoning: 32_000,
	coder: 32_000,
	fast: 8_000,
	"long-context": 128_000,
	vision: 0,
};

/** Tab 09, Gateway: back-off steps after a 429 or 5xx; with 3 failures only the first two are reached. */
export const BACKOFF_MS = [2_000, 8_000, 30_000] as const;

/** Tab 09, Gateway: wait for a reset only when it comes sooner than this. */
export const RESET_WAIT_MAX_MS = 90_000;

/** Tab 09, Gateway: failures on one model before moving down the chain. */
export const FAILURES_PER_MODEL = 3;

/** Tab 09, Gateway: the quota estimate counts this many prompt characters as one token. */
export const CHARS_PER_TOKEN = 4;

/** Tab 09, Tier resolution: the `long_context` need asks for the long-context tier's window. */
export const LONG_CONTEXT_MIN = TIER_MIN_CONTEXT["long-context"];

/** Tab 07, model_calls: rows follow the event retention of 90 days. */
export const MODEL_CALL_RETENTION_DAYS = 90;
