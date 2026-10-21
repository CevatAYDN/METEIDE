import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type {
	ChatChunk,
	ChatRequest,
	EmbedRequest,
	EmbedResponse,
	ProviderError,
	Result,
} from "@mete/contracts";
import { err, ok } from "@mete/contracts";
import { streamChat, toProviderError } from "./sdk-chat.js";

// The `openai-chat` format (docs/09) on @ai-sdk/openai-compatible (ADR-039).

/** Where and how to reach one OpenAI-compatible endpoint. */
export type OpenAIChatOptions = {
	readonly name: string;
	readonly baseURL: string;
	readonly apiKey: string;
	readonly headers?: Record<string, string>;
	/** Injected in tests; real calls use the global fetch. */
	readonly fetch?: typeof globalThis.fetch;
	/** Adds provider fields to the request body, such as OpenRouter's `provider`. */
	readonly extraBody?: Record<string, unknown>;
};

/** Creates chat and embed for one OpenAI-compatible endpoint. */
export const createOpenAIChat = (opts: OpenAIChatOptions) => {
	const { extraBody } = opts;
	const provider = createOpenAICompatible({
		name: opts.name,
		baseURL: opts.baseURL,
		apiKey: opts.apiKey,
		// shortcut: every endpoint gets stream_options.include_usage; make it an option if one rejects it (a bad_request chunk).
		includeUsage: true,
		...(opts.headers ? { headers: opts.headers } : {}),
		...(opts.fetch ? { fetch: opts.fetch } : {}),
		...(extraBody
			? { transformRequestBody: (body) => ({ ...body, ...extraBody }) }
			: {}),
	});

	const chat = (
		req: ChatRequest,
		signal: AbortSignal,
	): AsyncIterable<ChatChunk> =>
		streamChat(() => provider.chatModel(req.model), req, signal);

	const embed = async (
		req: EmbedRequest,
		signal: AbortSignal,
	): Promise<Result<EmbedResponse, ProviderError>> => {
		try {
			const model = provider.embeddingModel(req.model);
			const r = await model.doEmbed({
				values: [...req.input],
				abortSignal: signal,
			});
			return ok({ vectors: r.embeddings });
		} catch (error) {
			return err(toProviderError(error, signal));
		}
	};

	return { chat, embed };
};
