import type { ProviderError } from "@mete/contracts";

// HTTP status to ProviderError code (docs/06, provider types).

/** The error code for a failed HTTP status. */
export const codeForStatus = (status: number): ProviderError["code"] => {
	if (status === 429) return "rate_limited";
	if (status === 401 || status === 403) return "unauthorized";
	if (status >= 500) return "server";
	return "bad_request";
};
