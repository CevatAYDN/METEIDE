import type { QuotaObservation } from "@mete/contracts";
import { retryAfter } from "./retry-after.js";

// NVIDIA and OpenCode Zen document no rate-limit headers: a 429 closes their
// requests_per_minute unit until Retry-After, when one is sent (docs/09, observe() rules).

/** The observations a status and headers give for a provider with a minute limit only. */
export const observeMinute429 = (
	status: number,
	headers: Headers,
	now: number,
): QuotaObservation[] => {
	if (status !== 429) return [];
	const resetsAt = retryAfter(headers, now);
	return [
		{
			unit: "requests_per_minute",
			exhausted: true,
			...(resetsAt === undefined ? {} : { resetsAt }),
		},
	];
};

/**
 * A tokens-per-minute limit read from `header` of a failed response (docs/09, observe() rules;
 * ADR-056): it teaches the limit and leaves the window open. A missing or odd value teaches nothing.
 */
export const observeTokenLimit = (
	status: number,
	headers: Headers,
	header: string,
): QuotaObservation[] => {
	const value = headers.get(header);
	if (status < 400 || value === null || !/^\d+$/.test(value)) return [];
	const limit = Number(value);
	return limit > 0
		? [{ unit: "tokens_per_minute", limit, exhausted: false }]
		: [];
};
