import type {
	ChatChunk,
	ChatMessage,
	ChatRequest,
	ProviderError,
	QuotaObservation,
	ToolCall,
} from "@mete/contracts";
import {
	BACKOFF_MS,
	CHARS_PER_TOKEN,
	ESTIMATED_COMPLETION_TOKENS,
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

/**
 * The prompt and completion tokens a paid call is priced at before it runs: the completion is
 * `maxTokens`, or the documented estimate without it, so the spending cap holds (docs/09, ADR-042).
 */
export const tokensToPrice = (
	req: Pick<ChatRequest, "messages" | "tools" | "maxTokens">,
) => ({
	prompt: estimateTokens({
		messages: req.messages,
		...(req.tools ? { tools: req.tools } : {}),
	}),
	completion: req.maxTokens ?? ESTIMATED_COMPLETION_TOKENS,
});

type Usage = Extract<ChatChunk, { type: "finish" }>["usage"];

/**
 * A finish's usage as the gateway passes it on: as reported, or, when its prompt count is 0, the
 * estimate marked as such, since no chat completion has an empty prompt (ADR-168).
 */
export const usageOf = (
	reported: Usage,
	call: Pick<ChatRequest, "messages" | "tools">,
	seen: { readonly text: string; readonly toolCalls: readonly ToolCall[] },
): Usage => {
	if (reported.prompt > 0) return reported;
	const calls = seen.toolCalls.length ? JSON.stringify(seen.toolCalls) : "";
	return {
		prompt: estimateTokens({
			messages: call.messages,
			...(call.tools ? { tools: call.tools } : {}),
		}),
		completion: Math.ceil((seen.text.length + calls.length) / CHARS_PER_TOKEN),
		estimated: true,
	};
};
