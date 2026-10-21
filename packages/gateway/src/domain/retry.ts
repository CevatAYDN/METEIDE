import type {
	ChatMessage,
	ChatRequest,
	ProviderError,
	QuotaObservation,
} from "@mete/contracts";
import {
	BACKOFF_MS,
	CHARS_PER_TOKEN,
	FAILURES_PER_MODEL,
	RESET_WAIT_MAX_MS,
} from "../defaults.js";

// What the gateway does after a failed call, and its quota estimate (docs/09, Gateway).

/** Retry the same model after a wait, move to the next model, or end the call. */
export type Step =
	| { readonly kind: "retry"; readonly waitMs: number }
	| { readonly kind: "next" }
	| { readonly kind: "end" };

const earliestReset = (observations: readonly QuotaObservation[]) => {
	const times = observations
		.map((o) =>
			o.resetsAt === undefined ? Number.NaN : Date.parse(o.resetsAt),
		)
		.filter((t) => !Number.isNaN(t));
	return times.length > 0 ? Math.min(...times) : undefined;
};

/** `failures` counts this model's failures in this call, this one included. */
export const afterFailure = (
	error: ProviderError,
	failures: number,
	observations: readonly QuotaObservation[],
	now: number,
): Step => {
	if (error.code === "aborted") return { kind: "end" };
	if (error.code !== "rate_limited" && error.code !== "server")
		return { kind: "next" };
	if (failures >= FAILURES_PER_MODEL) return { kind: "next" };
	const reset = earliestReset(observations);
	if (reset !== undefined && reset - now < RESET_WAIT_MAX_MS)
		return { kind: "retry", waitMs: Math.max(0, reset - now) };
	return { kind: "retry", waitMs: BACKOFF_MS[failures - 1] ?? 0 };
};

const messageChars = (m: ChatMessage): number => {
	const content = m.content;
	if (typeof content !== "string")
		return content.reduce(
			(n, p) => n + (p.type === "text" ? p.text.length : 0),
			0,
		);
	const calls =
		m.role === "assistant" && m.toolCalls
			? JSON.stringify(m.toolCalls).length
			: 0;
	return content.length + calls;
};

/** Prompt characters over 4, rounded up, plus `maxTokens` when set. */
export const estimateTokens = (
	req: Pick<ChatRequest, "messages" | "tools" | "maxTokens">,
): number => {
	const chars =
		req.messages.reduce((n, m) => n + messageChars(m), 0) +
		(req.tools ? JSON.stringify(req.tools).length : 0);
	return Math.ceil(chars / CHARS_PER_TOKEN) + (req.maxTokens ?? 0);
};
