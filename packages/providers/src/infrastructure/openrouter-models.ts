import {
	type ModelInfo,
	ok,
	type ProviderError,
	type Result,
} from "@mete/contracts";
import { z } from "zod";
import { fetchJson } from "./model-list.js";

// OpenRouter's /models metadata to ModelInfo (docs/09, provider facts).

const ModelSchema = z.object({
	id: z.string().min(1),
	context_length: z.number().int().nonnegative().nullish(),
	architecture: z
		.object({ input_modalities: z.array(z.string()).nullish() })
		.nullish(),
	supported_parameters: z.array(z.string()).nullish(),
	expiration_date: z.string().nullish(),
	// US dollars per token, as decimal strings.
	pricing: z.object({ prompt: z.string(), completion: z.string() }).nullish(),
});
const ListSchema = z.object({ data: z.array(ModelSchema) });

// A paid model's price per million tokens (ADR-042); a free or unpriced model has none.
const priceOf = (m: z.infer<typeof ModelSchema>) => {
	if (!m.pricing || m.id.endsWith(":free")) return {};
	const input = Number(m.pricing.prompt) * 1_000_000;
	const output = Number(m.pricing.completion) * 1_000_000;
	const known =
		Number.isFinite(input) &&
		Number.isFinite(output) &&
		input >= 0 &&
		output >= 0;
	return known && input + output > 0 ? { price: { input, output } } : {};
};

const toInfo = (m: z.infer<typeof ModelSchema>, now: number): ModelInfo => {
	const expires = m.expiration_date
		? Date.parse(m.expiration_date)
		: Number.NaN;
	return {
		id: m.id,
		providerId: "openrouter",
		family: m.id.split("/")[0] ?? "",
		contextWindow: m.context_length ?? 0,
		toolCalling: m.supported_parameters?.includes("tools") ?? "unknown",
		vision: m.architecture?.input_modalities?.includes("image") ?? "unknown",
		free: m.id.endsWith(":free"),
		// "deprecated" read as: OpenRouter has set an expiration date that has passed.
		deprecated: Number.isFinite(expires) && expires <= now,
		...priceOf(m),
	};
};

/** The models OpenRouter lists, with the facts its metadata gives. */
export const listOpenRouterModels = async (
	url: string,
	apiKey: string,
	signal: AbortSignal,
	opts: { fetch?: typeof globalThis.fetch | undefined; now: number },
): Promise<Result<ModelInfo[], ProviderError>> => {
	const list = await fetchJson(url, apiKey, signal, {
		schema: ListSchema,
		fetch: opts.fetch,
	});
	return list.ok ? ok(list.value.data.map((m) => toInfo(m, opts.now))) : list;
};
