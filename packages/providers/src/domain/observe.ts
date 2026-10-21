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
