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

/** Tab 09, Tier resolution: the `long_context` need asks for the long-context tier's window. */
export const LONG_CONTEXT_MIN = TIER_MIN_CONTEXT["long-context"];
