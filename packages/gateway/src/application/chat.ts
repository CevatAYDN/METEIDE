import {
	type ChatRequest,
	err,
	type LlmChatAdapter,
	type LlmChatRequest,
	type LlmChunk,
	type LlmError,
	ok,
	type ProviderError,
	type QuotaAmounts,
	type QuotaObservation,
	type QuotaReserveAdapter,
	type ReserveFailed,
	type Result,
	type SecretsMaskAdapter,
} from "@mete/contracts";
import { type PrivacyRules, resolveChain } from "../domain/resolve.js";
import { afterFailure, estimateTokens } from "../domain/retry.js";
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
};

type Outcome =
	| {
			readonly kind: "finish";
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

type Walk = {
	readonly req: LlmChatRequest;
	readonly call: Omit<ChatRequest, "model">;
	readonly chain: readonly Offered[];
	readonly estimate: QuotaAmounts;
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

// One provider call; error chunks become the outcome instead of being forwarded.
async function* attempt(
	o: Offered,
	call: ChatRequest,
	signal: AbortSignal,
): AsyncGenerator<LlmChunk, Outcome> {
	let streamed = false;
	for await (const c of o.adapter.chat(call, signal)) {
		if (c.type === "error") return { kind: "error", error: c.error, streamed };
		yield c;
		if (c.type === "finish") return { kind: "finish", usage: c.usage };
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

const actualOf = (outcome: Outcome | undefined): QuotaAmounts =>
	outcome?.kind === "finish"
		? { tokens_per_minute: outcome.usage.prompt + outcome.usage.completion }
		: {};

// Settles exactly once, also when the caller stops reading mid-stream.
async function* settled(
	deps: ChatDeps,
	o: Offered,
	reservation: string,
	call: ChatRequest,
	signal: AbortSignal,
): AsyncGenerator<LlmChunk, Attempted> {
	if (signal.aborted) {
		deps.quota.settle(reservation, null, []);
		return {
			outcome: { kind: "error", error: ABORTED, streamed: false },
			observations: [],
		};
	}
	let outcome: Outcome | undefined;
	let observations: readonly QuotaObservation[] = [];
	try {
		outcome = yield* attempt(o, call, signal);
		observations = observationsOf(o, outcome);
		return { outcome, observations };
	} finally {
		deps.quota.settle(reservation, actualOf(outcome), observations);
	}
}

const refOf = (o: Offered) => ({
	providerId: o.model.providerId,
	modelId: o.model.id,
});

type WalkState = {
	remaining: readonly Offered[];
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
	const chain = remaining.map(refOf);
	const r = await deps.quota.reserve(
		{ runId, priority, chain, estimate: w.estimate },
		signal,
	);
	if (!r.ok) return err(reserveError(r.error));
	const { providerId, modelId, id } = r.value;
	const o = remaining.find(
		(x) => x.model.providerId === providerId && x.model.id === modelId,
	);
	if (!o)
		throw new Error(`quota granted ${modelId}, which is not in the chain`);
	return ok({ o, id });
};

// The model chunk when the call moves to another model, else undefined.
const nameModel = (st: WalkState, o: Offered, first: Offered | undefined) => {
	if (o === st.shown) return undefined;
	const reason = o === first ? "first" : st.moved ? "failed" : "quota";
	st.shown = o;
	st.moved = false;
	return { type: "model", ...refOf(o), reason } as const;
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
	if (step.kind === "next") {
		st.remaining = st.remaining.filter((x) => x !== o);
		st.last = outcome.error;
		st.moved = true;
		return undefined;
	}
	await deps.sleep(step.waitMs, signal);
	return signal.aborted ? ABORTED : undefined;
};

async function* walk(
	deps: ChatDeps,
	w: Walk,
	signal: AbortSignal,
): AsyncGenerator<LlmChunk> {
	const st: WalkState = {
		remaining: w.chain,
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
		if (named) yield named;
		const call = { ...w.call, model: o.model.id };
		const { outcome, observations } = yield* settled(deps, o, id, call, signal);
		if (outcome.kind === "finish") return;
		const end = await onFailure(deps, st, { o, outcome, observations }, signal);
		if (end) return yield fail(end);
	}
	yield fail(st.last);
}

async function* chat(
	deps: ChatDeps,
	req: LlmChatRequest,
	signal: AbortSignal,
): AsyncGenerator<LlmChunk> {
	if (signal.aborted) return yield fail(ABORTED);
	const offered = await deps.discover(signal);
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
	yield* walk(deps, { req, call, chain, estimate }, signal);
}

/** The gateway's routed chat. */
export const createLlmChat = (deps: ChatDeps): LlmChatAdapter => ({
	chat: (req, signal) => chat(deps, req, signal),
});
