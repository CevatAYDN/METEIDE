import {
	type EmbedRequest,
	type EmbedResponse,
	ok,
	type ProviderError,
	type RerankRequest,
	type RerankResponse,
	type Result,
} from "@mete/contracts";
import { z } from "zod";
import { fetchJson } from "./model-list.js";

// NVIDIA embeddings and rerank (docs/09, observe() rules: endpoints from the NVIDIA API reference).

const EmbedSchema = z.object({
	data: z.array(
		z.object({ index: z.number().int(), embedding: z.array(z.number()) }),
	),
});

const RankSchema = z.object({
	rankings: z.array(z.object({ index: z.number().int(), logit: z.number() })),
});

type Call = {
	readonly apiKey: string;
	readonly fetch?: typeof globalThis.fetch | undefined;
};

/** Embeds with `input_type` from the request's purpose; vectors come back in input order. */
export const nvidiaEmbed = async (
	url: string,
	req: EmbedRequest,
	signal: AbortSignal,
	call: Call,
): Promise<Result<EmbedResponse, ProviderError>> => {
	const body = {
		model: req.model,
		input: req.input,
		input_type: req.purpose === "query" ? "query" : "passage",
		encoding_format: "float",
	};
	const r = await fetchJson(url, call.apiKey, signal, {
		schema: EmbedSchema,
		body,
		fetch: call.fetch,
	});
	if (!r.ok) return r;
	const ordered = [...r.value.data].sort((a, b) => a.index - b.index);
	return ok({ vectors: ordered.map((d) => d.embedding) });
};

/** Ranks documents; scores come back one per document, in input order. */
export const nvidiaRerank = async (
	url: string,
	req: RerankRequest,
	signal: AbortSignal,
	call: Call,
): Promise<Result<RerankResponse, ProviderError>> => {
	const body = {
		model: req.model,
		query: { text: req.query },
		passages: req.documents.map((text) => ({ text })),
	};
	const r = await fetchJson(url, call.apiKey, signal, {
		schema: RankSchema,
		body,
		fetch: call.fetch,
	});
	if (!r.ok) return r;
	// A passage the answer leaves out ranks last.
	const scores = req.documents.map(() => Number.NEGATIVE_INFINITY);
	for (const { index, logit } of r.value.rankings)
		if (index >= 0 && index < scores.length) scores[index] = logit;
	return ok({ scores });
};
