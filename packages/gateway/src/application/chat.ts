import {
	type ChatChunk,
	type ChatRequest,
	err,
	type LlmChatAdapter,
	type LlmChatRequest,
	type LlmChunk,
	type LlmError,
	type ModelInfo,
	ok,
	type ProviderError,
	type QuotaAmounts,
	type QuotaObservation,
	type QuotaReserveAdapter,
	type ReserveFailed,
	type Result,
	type SecretsMaskAdapter,
	type ToolCall,
} from "@mete/contracts";
import { CHAIN_LENGTH } from "../defaults.js";
import { type PrivacyRules, resolveChain } from "../domain/resolve.js";
import { afterFailure, estimateTokens } from "../domain/retry.js";
import { costOf } from "../domain/spend.js";
import type { ModelCall } from "../infrastructure/model-calls.js";
import { maskMessages, type Offered } from "./prepare.js";

// The llm.chat@1 request pipeline (docs/09, Gateway): privacy filter → secret masking →
// quota reservation → provider call → quota observation, moving down the chain on failures.

export type ChatDeps = {
	readonly discover: (signal: AbortSignal) => Promise<Offered[]>;
	readonly quota: QuotaReserveAdapter;
	readonly mask: SecretsMaskAdapter;
	readonly rules: () => PrivacyRules;
	readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
	readonly now: () => number;
	/** Keeps one row per provider call for replay (docs/07, model_calls). */
	readonly record: (call: ModelCall) => void;
	readonly warn: (
		fields: Readonly<Record<string, unknown>>,
		msg: string,
	) => void;
};

type Outcome =
	| {
			readonly kind: "finish";
			readonly reason: Extract<ChatChunk, { type: "finish" }>["reason"];
			readonly usage: { prompt: number; completion: number };
	  }
	| {
			readonly kind: "error";
			readonly error: ProviderError;
			readonly streamed: boolean;
	  };

type Attempted = {
	readonly outcome: Outcome;
	readonly observations: readonly QuotaObservation[];
};

// What a model streamed, kept for the model_calls row.
type Seen = { text: string; readonly toolCalls: ToolCall[] };

// One reserved call on one model.
type Try = {
	readonly o: Offered;
	readonly reservation: string;
	readonly call: ChatRequest;
	readonly req: LlmChatRequest;
};

type Walk = {
	readonly req: LlmChatRequest;
	readonly call: Omit<ChatRequest, "model">;
	readonly chain: readonly Offered[];
	readonly estimate: QuotaAmounts;
	/** Prompt tokens and the completion it may take, for a paid model's cost (ADR-042). */
	readonly tokens: { readonly prompt: number; readonly completion: number };
};

const ABORTED: ProviderError = {
	code: "aborted",
	message: "the call was aborted",
};

const fail = (error: LlmError): LlmChunk => ({ type: "error", error });

const reserveError = (e: ReserveFailed): LlmError =>
	e.code === "aborted"
		? ABORTED
		: {
				code: "quota_exhausted",
				message: `quota exhausted until ${e.resumesAt}`,
				resumesAt: e.resumesAt,
			};

// How the call ended, set before the finish is yielded.
type Ended = { outcome: Outcome | undefined };

// Adds a chunk to the call's record; a finish chunk gives the outcome.
const keep = (
	seen: Seen,
	c: Exclude<ChatChunk, { type: "error" }>,
): Outcome | undefined => {
	if (c.type === "text") seen.text += c.text;
	if (c.type === "tool-call")
		seen.toolCalls.push({ id: c.id, name: c.name, args: c.args });
	return c.type === "finish"
		? { kind: "finish", reason: c.reason, usage: c.usage }
		: undefined;
};

// One provider call; error chunks become the outcome instead of being forwarded.
// Text, tool calls and the finish are kept before their yield: a caller that stops
// reading, as core does at the finish chunk, never resumes it.
async function* attempt(
	t: Try,
	seen: Seen,
	ended: Ended,
	signal: AbortSignal,
): AsyncGenerator<LlmChunk, Outcome> {
	let streamed = false;
	for await (const c of t.o.adapter.chat(t.call, signal)) {
		if (c.type === "error") return { kind: "error", error: c.error, streamed };
		ended.outcome = keep(seen, c);
		yield c;
		if (ended.outcome) return ended.outcome;
		streamed = true;
	}
	const error: ProviderError = {
		code: "network",
		message: "the stream ended without a finish",
	};
	return { kind: "error", error, streamed };
}

const observationsOf = (o: Offered, outcome: Outcome) =>
	outcome.kind === "error" && outcome.error.status !== undefined
		? o.adapter.observe(
				outcome.error.status,
				outcome.error.headers ?? new Headers(),
			)
		: [];

// A paid call also settles what its reported usage cost (ADR-042).
const actualOf = (
	outcome: Outcome | undefined,
	model: ModelInfo,
): QuotaAmounts =>
	outcome?.kind === "finish"
		? {
				tokens_per_minute: outcome.usage.prompt + outcome.usage.completion,
				...costOf(model, outcome.usage),
			}
		: {};

// A caller that stopped reading leaves no outcome; it is logged as aborted.
const callRow = (
	t: Try,
	outcome: Outcome | undefined,
	seen: Seen,
	times: { readonly start: number; readonly end: number },
): ModelCall => ({
	ts: new Date(times.start).toISOString(),
	runId: t.req.runId,
	providerId: t.o.model.providerId,
	modelId: t.o.model.id,
	tier: "tier" in t.req.target ? t.req.target.tier : null,
	request: { messages: t.call.messages, tools: t.call.tools ?? [] },
	response: seen,
	promptTokens: outcome?.kind === "finish" ? outcome.usage.prompt : 0,
	completionTokens: outcome?.kind === "finish" ? outcome.usage.completion : 0,
	latencyMs: times.end - times.start,
	outcome:
		outcome === undefined
			? "aborted"
			: outcome.kind === "finish"
				? outcome.reason
				: outcome.error.code,
});

// Settles and logs exactly once, also when the caller stops reading mid-stream or at
// the model chunk, which is why that chunk is yielded inside the try.
async function* settled(
	deps: ChatDeps,
	t: Try,
	named: LlmChunk | undefined,
	signal: AbortSignal,
): AsyncGenerator<LlmChunk, Attempted> {
	if (signal.aborted) {
		deps.quota.settle(t.reservation, null, []);
		return {
			outcome: { kind: "error", error: ABORTED, streamed: false },
			observations: [],
		};
	}
	const ended: Ended = { outcome: undefined };
	let observations: readonly QuotaObservation[] = [];
	const seen: Seen = { text: "", toolCalls: [] };
	const start = deps.now();
	try {
		if (named) yield named;
		ended.outcome = yield* attempt(t, seen, ended, signal);
		observations = observationsOf(t.o, ended.outcome);
		return { outcome: ended.outcome, observations };
	} finally {
		const { outcome } = ended;
		deps.quota.settle(
			t.reservation,
			actualOf(outcome, t.o.model),
			observations,
		);
		deps.record(callRow(t, outcome, seen, { start, end: deps.now() }));
	}
}

const refOf = (o: Offered) => ({
	providerId: o.model.providerId,
	modelId: o.model.id,
});

// A paid entry carries its estimated cost, so the spending cap holds it back (ADR-042).
const entryOf = (o: Offered, tokens: Walk["tokens"]) => {
	const cost = costOf(o.model, tokens);
	return { ...refOf(o), ...("usd_per_day" in cost ? { estimate: cost } : {}) };
};

type WalkState = {
	remaining: readonly Offered[];
	/** Models that failed for a reason other than a refused key (CHAIN_LENGTH). */
	tried: number;
	/** Models that refused the key, left out for the gateway's lifetime. */
	readonly refused: Set<string>;
	shown: Offered | undefined;
	moved: boolean;
	last: ProviderError;
	readonly failures: Map<Offered, number>;
};

type Failed = {
	readonly o: Offered;
	readonly outcome: Extract<Outcome, { kind: "error" }>;
	readonly observations: readonly QuotaObservation[];
};

const grant = async (
	deps: ChatDeps,
	w: Walk,
	remaining: readonly Offered[],
	signal: AbortSignal,
): Promise<Result<{ o: Offered; id: string }, LlmError>> => {
	const { runId, priority } = w.req;
	const chain = remaining.map((o) => entryOf(o, w.tokens));
	const r = await deps.quota.reserve(
		{ runId, priority, chain, estimate: w.estimate },
		signal,
	);
	if (!r.ok) return err(reserveError(r.error));
	const { providerId, modelId, id } = r.value;
	const o = remaining.find(
		(x) => x.model.providerId === providerId && x.model.id === modelId,
	);
	if (!o) {
		deps.quota.settle(id, null, []);
		throw new Error(`quota granted ${modelId}, which is not in the chain`);
	}
	return ok({ o, id });
};

// The model chunk when the call moves to another model, else undefined.
const nameModel = (st: WalkState, o: Offered, first: Offered | undefined) => {
	if (o === st.shown) return undefined;
	const reason = st.moved ? "failed" : o === first ? "first" : "quota";
	st.shown = o;
	st.moved = false;
	return { type: "model", ...refOf(o), reason } as const;
};

const keyOf = (o: Offered) => `${o.model.providerId}/${o.model.id}`;

// shortcut: a refused model stays out until the gateway restarts, so a new key needs a new process.
const refuse = (
	deps: ChatDeps,
	st: WalkState,
	o: Offered,
	e: ProviderError,
) => {
	st.refused.add(keyOf(o));
	deps.warn(
		{ ...refOf(o), code: e.code, status: e.status, reason: e.message },
		"model refused the key; left out until the gateway restarts",
	);
};

// Leaves the model; ends the call once CHAIN_LENGTH models failed for another reason.
const moveOn = (
	deps: ChatDeps,
	st: WalkState,
	o: Offered,
	e: ProviderError,
): LlmError | undefined => {
	st.remaining = st.remaining.filter((x) => x !== o);
	st.last = e;
	st.moved = true;
	if (e.code === "unauthorized") refuse(deps, st, o, e);
	else st.tried++;
	return st.tried >= CHAIN_LENGTH ? e : undefined;
};

// The error that ends the call, or undefined to reserve again.
const onFailure = async (
	deps: ChatDeps,
	st: WalkState,
	{ o, outcome, observations }: Failed,
	signal: AbortSignal,
): Promise<LlmError | undefined> => {
	if (outcome.streamed) return outcome.error;
	const n = (st.failures.get(o) ?? 0) + 1;
	st.failures.set(o, n);
	const step = afterFailure(outcome.error, n, observations, deps.now());
	if (step.kind === "end") return outcome.error;
	if (step.kind === "next") return moveOn(deps, st, o, outcome.error);
	await deps.sleep(step.waitMs, signal);
	return signal.aborted ? ABORTED : undefined;
};

async function* walk(
	deps: ChatDeps,
	w: Walk,
	refused: Set<string>,
	signal: AbortSignal,
): AsyncGenerator<LlmChunk> {
	const st: WalkState = {
		remaining: w.chain,
		tried: 0,
		refused,
		shown: undefined,
		moved: false,
		last: ABORTED,
		failures: new Map(),
	};
	while (st.remaining.length > 0) {
		const g = await grant(deps, w, st.remaining, signal);
		if (!g.ok) return yield fail(g.error);
		const { o, id } = g.value;
		const named = nameModel(st, o, w.chain[0]);
		const call = { ...w.call, model: o.model.id };
		const t: Try = { o, reservation: id, call, req: w.req };
		const { outcome, observations } = yield* settled(deps, t, named, signal);
		if (outcome.kind === "finish") return;
		const end = await onFailure(deps, st, { o, outcome, observations }, signal);
		if (end) return yield fail(end);
	}
	yield fail(st.last);
}

async function* chat(
	deps: ChatDeps,
	refused: Set<string>,
	req: LlmChatRequest,
	signal: AbortSignal,
): AsyncGenerator<LlmChunk> {
	if (signal.aborted) return yield fail(ABORTED);
	const found = await deps.discover(signal);
	// A listing cut short by the abort is empty; that is not no_model.
	if (signal.aborted) return yield fail(ABORTED);
	const offered = found.filter((o) => !refused.has(keyOf(o)));
	const models = resolveChain(offered, req.target, deps.rules(), req);
	const chain = models.flatMap((m) => offered.filter((o) => o.model === m));
	if (chain.length === 0)
		return yield fail({
			code: "no_model",
			message: "no discovered model fits this call",
		});
	const messages = await maskMessages(deps.mask, req.messages);
	const { target, runId, priority, needs, avoidFamilies, ...rest } = req;
	const call = { ...rest, messages };
	const estimate = { tokens_per_minute: estimateTokens(call) };
	const prompt = estimateTokens({
		messages: call.messages,
		...(call.tools ? { tools: call.tools } : {}),
	});
	const tokens = { prompt, completion: call.maxTokens ?? 0 };
	yield* walk(deps, { req, call, chain, estimate, tokens }, refused, signal);
}

/** The gateway's routed chat; it remembers the models that refused their key. */
export const createLlmChat = (deps: ChatDeps): LlmChatAdapter => {
	const refused = new Set<string>();
	return { chat: (req, signal) => chat(deps, refused, req, signal) };
};
