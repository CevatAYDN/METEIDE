import {
	type EmbedResponse,
	err,
	type LlmEmbedAdapter,
	type LlmEmbedRequest,
	type LlmEmbedResponse,
	type LlmError,
	ok,
	type ProviderError,
	type QuotaObservation,
	type Result,
} from "@mete/contracts";
import { CHARS_PER_TOKEN } from "../defaults.js";
import { ABORTED, chainEnd } from "../domain/llm-errors.js";
import { type PrivacyRules, usableModels } from "../domain/resolve.js";
import { costOf } from "../domain/spend.js";
import type { ModelCall } from "../infrastructure/model-calls.js";
import {
	type ChatDeps,
	grant,
	keyOf,
	onFailure,
	refOf,
	type WalkState,
} from "./chat.js";
import { demoted, forgive, type Memory, newMemory } from "./model-memory.js";
import type { Offered } from "./prepare.js";

// The llm.embed@1 pipeline (docs/09, Gateway; ADR-152): privacy filter → secret masking → quota
// reservation → provider call → quota observation → log, moving down the chain as llm.chat@2 does.
// Embedding is no tier and takes no pin.

/** What the pipeline needs; `discover` lists the embedding models (provider.embed@2). */
export type EmbedDeps = Omit<ChatDeps, "stall">;

type Call = {
	readonly req: LlmEmbedRequest;
	/** The input with secrets masked, as sent. */
	readonly input: readonly string[];
	readonly chain: readonly Offered[];
	readonly estimate: { readonly tokens_per_minute: number };
	readonly tokens: { readonly prompt: number; readonly completion: number };
};

type Granted = { readonly o: Offered; readonly id: string };

type Answer = {
	readonly r: Result<EmbedResponse, ProviderError>;
	readonly observations: readonly QuotaObservation[];
};

/** The embedding models the mode and the privacy filter allow, free first (ADR-042), each in listed order. */
export const embedOrder = (
	found: readonly Offered[],
	rules: PrivacyRules,
): Offered[] => {
	const models = usableModels(found, rules);
	const ordered = [
		...models.filter((m) => m.free),
		...models.filter((m) => !m.free),
	];
	return ordered.flatMap((m) => found.filter((o) => o.model === m));
};

// The models that did not refuse their key, the failing ones last.
const chainOf = (
	found: readonly Offered[],
	memory: Memory,
	deps: EmbedDeps,
) => {
	const offered = found.filter((o) => !memory.refused.has(keyOf(o)));
	return demoted(embedOrder(offered, deps.rules()), memory, keyOf);
};

const row = (
	c: Call,
	o: Offered,
	r: Answer["r"],
	times: { readonly start: number; readonly end: number },
): ModelCall => ({
	ts: new Date(times.start).toISOString(),
	runId: c.req.runId,
	...refOf(o),
	tier: null,
	request: { input: c.input, purpose: c.req.purpose },
	// Vectors are not kept for replay; their count and length say what came back.
	response: r.ok
		? { vectors: r.value.vectors.length, length: r.value.vectors[0]?.length }
		: {},
	promptTokens: 0,
	completionTokens: 0,
	latencyMs: times.end - times.start,
	outcome: r.ok ? "stop" : r.error.code,
});

// One provider call, settled and logged once; an embedding reports no usage, so the estimate settles.
const attempt = async (
	deps: EmbedDeps,
	c: Call,
	{ o, id }: Granted,
	signal: AbortSignal,
): Promise<Answer> => {
	if (signal.aborted) {
		deps.quota.settle(id, null, []);
		return { r: err(ABORTED), observations: [] };
	}
	if (!o.adapter.embed) throw new Error(`${o.adapter.id} lists no embed`);
	const start = deps.now();
	const { purpose } = c.req;
	const call = { model: o.model.id, input: c.input, purpose };
	const r = await o.adapter.embed(call, signal);
	const observations =
		!r.ok && r.error.status !== undefined
			? o.adapter.observe(r.error.status, r.error.headers ?? new Headers())
			: [];
	const actual = r.ok ? { ...c.estimate, ...costOf(o.model, c.tokens) } : {};
	deps.quota.settle(id, actual, observations);
	deps.record(row(c, o, r, { start, end: deps.now() }));
	return { r, observations };
};

const walk = async (
	deps: EmbedDeps,
	c: Call,
	memory: Memory,
	signal: AbortSignal,
): Promise<Result<LlmEmbedResponse, LlmError>> => {
	const st: WalkState = {
		remaining: c.chain,
		tried: 0,
		memory,
		shown: undefined,
		moved: false,
		last: ABORTED,
		failures: new Map(),
		passed: false,
	};
	while (st.remaining.length > 0) {
		const g = await grant(deps, c, st.remaining, signal);
		if (!g.ok) return err(g.error);
		const { o } = g.value;
		const { r, observations } = await attempt(deps, c, g.value, signal);
		if (r.ok) {
			forgive(memory, keyOf(o));
			return ok({ vectors: r.value.vectors, model: refOf(o) });
		}
		const outcome = { kind: "error", error: r.error, streamed: false } as const;
		const end = await onFailure(deps, st, { o, outcome, observations }, signal);
		if (end) return err(end);
	}
	return err(chainEnd(st.last, st.passed));
};

const embed = async (
	deps: EmbedDeps,
	memory: Memory,
	req: LlmEmbedRequest,
	signal: AbortSignal,
): Promise<Result<LlmEmbedResponse, LlmError>> => {
	if (signal.aborted) return err(ABORTED);
	const found = await deps.discover(signal);
	// A listing cut short by the abort is empty; that is not no_model.
	if (signal.aborted) return err(ABORTED);
	const chain = chainOf(found, memory, deps);
	if (chain.length === 0)
		return err({ code: "no_model", message: "no embedding model is allowed" });
	const mask = async (t: string) => (await deps.mask.mask(t)).text;
	const input = await Promise.all(req.input.map(mask));
	const chars = input.reduce((n, t) => n + t.length, 0);
	const prompt = Math.ceil(chars / CHARS_PER_TOKEN);
	const estimate = { tokens_per_minute: prompt };
	const tokens = { prompt, completion: 0 };
	return walk(deps, { req, input, chain, estimate, tokens }, memory, signal);
};

/** The gateway's routed embeddings; it remembers the models that refused their key. */
export const createLlmEmbed = (deps: EmbedDeps): LlmEmbedAdapter => {
	const memory = newMemory();
	return { embed: (req, signal) => embed(deps, memory, req, signal) };
};
