import type { LlmError, ProviderError, ReserveFailed } from "@mete/contracts";

// How a routed call ends when it is aborted or the pool grants nothing (docs/09, llm.chat@2).

/** The error of an aborted call. */
export const ABORTED: ProviderError = {
	code: "aborted",
	message: "the call was aborted",
};

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
