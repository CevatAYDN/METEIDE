// Named defaults for this package; each names the document tab that defines it (CONTRIBUTING.md).
// Tier context minimums and the token estimate are shared with core-engine (tab 09), so they
// live in @mete/contracts.
import { TIER_MIN_CONTEXT } from "@mete/contracts";

export { CHARS_PER_TOKEN, TIER_MIN_CONTEXT } from "@mete/contracts";

/** Tier resolution: a call tries at most 4 models; one that refused the key does not count (tab 09). */
export const CHAIN_LENGTH = 4;

/** Tab 09, Gateway: back-off steps after a 429 or 5xx; with 3 failures only the first two are reached. */
export const BACKOFF_MS = [2_000, 8_000, 30_000] as const;

/** Tab 09, Gateway: wait for a reset only when it comes sooner than this. */
export const RESET_WAIT_MAX_MS = 90_000;

/** Tab 09, Gateway: failures on one model before moving down the chain. */
export const FAILURES_PER_MODEL = 3;

/** Tab 09, Tier resolution: the `long_context` need asks for the long-context tier's window. */
export const LONG_CONTEXT_MIN = TIER_MIN_CONTEXT["long-context"];

/** Tab 07, model_calls: rows follow the event retention of 90 days. */
export const MODEL_CALL_RETENTION_DAYS = 90;

/** Tab 09, Gateway (ADR-042): the daily spending cap over paid models, in US dollars. */
export const DAILY_SPEND_USD = 1;
