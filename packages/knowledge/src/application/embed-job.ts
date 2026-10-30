import type {
	LlmEmbedAdapter,
	LlmEmbedRequest,
	ModelRef,
} from "@mete/contracts";
import type { CapabilityRegistry } from "@mete/kernel";
import { EMBED_BATCH } from "../defaults.js";
import type { KeywordIndex } from "../infrastructure/keyword-index.js";
import { cacheKey, type VectorIndex } from "../infrastructure/vector-index.js";

// The vault's embeddings in the background (docs/11, Indexing; ADR-152): the indexed sections with no
// vector from the model that answered last are embedded at priority 2 under the nil run id, in batches
// of EMBED_BATCH, one round at a time. Only knowledge_chunks is read, which never holds a private note
// or a file .meteignore matches. quota_exhausted stops the rounds until its resumesAt.

/** The run id no run has, under which the vault is embedded (ADR-152). */
export const NIL_RUN = "00000000-0000-0000-0000-000000000000";

/** What the job needs from its module. */
export type JobDeps = {
	readonly registry: CapabilityRegistry;
	readonly index: KeywordIndex;
	readonly vectors: VectorIndex;
	readonly now: () => number;
	readonly warn: (message: string) => void;
};

/** llm.embed@1, resolved at each call since the gateway may come and go; none without it. */
export const embedderOf = (registry: CapabilityRegistry) => {
	const chain = registry.resolve<LlmEmbedAdapter>("llm.embed@1");
	return chain.ok ? chain.value[0].impl : undefined;
};

/** The model id stored vectors keep. */
export const modelKey = (m: ModelRef) => `${m.providerId}/${m.modelId}`;

// The distinct section texts with no vector from the latest model; all of them before any answer.
const pending = (deps: JobDeps) => {
	const texts = [
		...new Set(
			deps.index
				.chunks({})
				.map((c) => c.body)
				.filter((b) => b.trim()),
		),
	];
	const model = deps.vectors.latest();
	if (!model) return texts;
	const keys = texts.map((t) => cacheKey(t, model));
	const have = deps.vectors.stored(model, keys);
	return texts.filter((_, i) => !have.has(keys[i] ?? ""));
};

type Stop = { readonly until: number } | { readonly warn: string };

// One batch embedded and stored under the model that answered; a stop ends the round.
const batch = async (
	deps: JobDeps,
	embedder: LlmEmbedAdapter,
	input: readonly string[],
	signal: AbortSignal,
): Promise<Stop | undefined> => {
	const req: LlmEmbedRequest = {
		input,
		purpose: "document",
		runId: NIL_RUN,
		priority: 2,
	};
	const r = await embedder.embed(req, signal);
	if (!r.ok)
		return r.error.code === "quota_exhausted"
			? { until: Date.parse(r.error.resumesAt) }
			: { warn: r.error.message };
	const model = modelKey(r.value.model);
	const rows = input.flatMap((text, i) => {
		const vector = r.value.vectors[i];
		return vector ? [{ key: cacheKey(text, model), vector }] : [];
	});
	const put = deps.vectors.put(model, rows);
	return put.ok ? undefined : { warn: put.error };
};

type State = { pausedUntil: number; again: boolean };

// No round without llm.embed@1 or sqlite-vec, or during a quota pause.
const embedderFor = (deps: JobDeps, state: State) =>
	deps.vectors.available && deps.now() >= state.pausedUntil
		? embedderOf(deps.registry)
		: undefined;

const settle = (deps: JobDeps, state: State, stop: Stop) => {
	if ("until" in stop) state.pausedUntil = stop.until;
	else deps.warn(stop.warn);
};

const round = async (deps: JobDeps, state: State, signal: AbortSignal) => {
	const embedder = embedderFor(deps, state);
	if (!embedder) return;
	const texts = pending(deps);
	for (let i = 0; i < texts.length && !signal.aborted; i += EMBED_BATCH) {
		const input = texts.slice(i, i + EMBED_BATCH);
		const stop = await batch(deps, embedder, input, signal);
		if (stop) return signal.aborted ? undefined : settle(deps, state, stop);
	}
};

/** The background job: `kick` starts a round, or one more after the running one. */
export const embedJob = (deps: JobDeps) => {
	const abort = new AbortController();
	const state: State = { pausedUntil: 0, again: false };
	let running: Promise<void> | undefined;
	const loop = async () => {
		do {
			state.again = false;
			await round(deps, state, abort.signal);
		} while (state.again && !abort.signal.aborted);
	};
	return {
		kick: () => {
			if (running) state.again = true;
			else
				running = loop()
					.catch((e: unknown) => deps.warn(String(e)))
					.finally(() => {
						running = undefined;
					});
		},
		/** A search's query met quota_exhausted: no round until then. */
		pauseUntil: (resumesAt: string) => {
			state.pausedUntil = Math.max(state.pausedUntil, Date.parse(resumesAt));
		},
		stop: () => abort.abort(),
	};
};

/** The module's background job. */
export type EmbedJob = ReturnType<typeof embedJob>;
