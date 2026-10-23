import type { LlmError, ProviderError, ReserveFailed } from "@mete/contracts";

// How a routed call ends when it is aborted or the pool grants nothing (docs/09, llm.chat@2).

/** The error of an aborted call. */
export const ABORTED: ProviderError = {
	code: "aborted",
	message: "the call was aborted",
};

/** A failure that may pass by itself: the provider is slow, down or busy (docs/09, Chain end). */
export const passes = (e: ProviderError) =>
	e.code === "network" || e.code === "server" || e.code === "rate_limited";

/** A model the provider does not serve now: a refused key, or a 404 for a model it listed (ADR-064). */
export const unavailable = (e: ProviderError) =>
	e.code === "unauthorized" || (e.code === "bad_request" && e.status === 404);

/** The error a chain that ran out ends with: network after a failure that passes, else the last. */
export const chainEnd = (last: LlmError, passed: boolean): LlmError =>
	passed && last.code !== "aborted"
		? {
				code: "network",
				message: `no model of the chain answered now; the last said: ${last.message}`,
			}
		: last;

/** A failed reservation as the call's error; `tokens` is the estimate a too-large call names (ADR-056). */
export const reserveError = (
	e: ReserveFailed,
	tokens: number | undefined,
): LlmError => {
	if (e.code === "aborted") return ABORTED;
	if (e.code === "too_large")
		return {
			code: "too_large",
			message: `no model of the chain takes a request this large (about ${tokens ?? 0} tokens)`,
		};
	return {
		code: "quota_exhausted",
		message: `quota exhausted until ${e.resumesAt}`,
		resumesAt: e.resumesAt,
	};
};
