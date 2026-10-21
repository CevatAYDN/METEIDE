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
import { z } from "zod";
import { codeForStatus } from "../domain/errors.js";
import { type CallOptions, toPrompt, toTools } from "./openai-prompt.js";

// The `openai-chat` format (docs/09) on @ai-sdk/openai-compatible (ADR-039): chat
// streams ChatChunks and ends with exactly one finish or one error chunk.

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

type StreamPart =
	Awaited<
		ReturnType<
			ReturnType<
				ReturnType<typeof createOpenAICompatible>["chatModel"]
			>["doStream"]
		>
	>["stream"] extends ReadableStream<infer P>
		? P
		: never;

// The SDK's APICallError, read by shape so @ai-sdk/provider is not imported.
const ApiCallErrorSchema = z.object({
	name: z.literal("AI_APICallError"),
	message: z.string(),
	statusCode: z.number().optional(),
	responseHeaders: z.record(z.string(), z.string()).optional(),
});

/** Any thrown or streamed failure as a ProviderError. */
export const toProviderError = (
	error: unknown,
	signal: AbortSignal,
): ProviderError => {
	if (signal.aborted)
		return { code: "aborted", message: "the call was aborted" };
	const api = ApiCallErrorSchema.safeParse(error);
	if (api.success && api.data.statusCode !== undefined)
		return {
			code: codeForStatus(api.data.statusCode),
			message: api.data.message,
			status: api.data.statusCode,
			headers: new Headers(api.data.responseHeaders),
		};
	const message = error instanceof Error ? error.message : String(error);
	return { code: "network", message };
};

const parseArgs = (input: string): unknown => {
	try {
		return JSON.parse(input);
	} catch {
		return input; // the tool layer validates arguments and reports the bad call
	}
};

// One SDK part as a chunk; undefined for parts METE does not stream.
const toChunk = (
	part: StreamPart,
	signal: AbortSignal,
): ChatChunk | undefined => {
	switch (part.type) {
		case "text-delta":
			return { type: "text", text: part.delta };
		case "tool-call":
			return {
				type: "tool-call",
				id: part.toolCallId,
				name: part.toolName,
				args: parseArgs(part.input),
			};
		case "error":
			return { type: "error", error: toProviderError(part.error, signal) };
		case "finish":
			if (part.finishReason.raw === "error")
				return {
					type: "error",
					error: {
						code: "server",
						message: "the provider ended the stream with an error",
					},
				};
			return {
				type: "finish",
				reason:
					part.finishReason.unified === "error"
						? "other"
						: part.finishReason.unified,
				usage: {
					prompt: part.usage.inputTokens.total ?? 0,
					completion: part.usage.outputTokens.total ?? 0,
				},
			};
		default:
			return undefined;
	}
};

const callOptions = (req: ChatRequest, signal: AbortSignal): CallOptions => ({
	prompt: toPrompt(req.messages),
	abortSignal: signal,
	...(req.tools ? { tools: toTools(req.tools) } : {}),
	...(req.maxTokens === undefined ? {} : { maxOutputTokens: req.maxTokens }),
	...(req.temperature === undefined ? {} : { temperature: req.temperature }),
});

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

	async function* chat(
		req: ChatRequest,
		signal: AbortSignal,
	): AsyncIterable<ChatChunk> {
		try {
			if (signal.aborted) throw new Error("aborted");
			const model = provider.chatModel(req.model);
			const { stream } = await model.doStream(callOptions(req, signal));
			for await (const part of stream) {
				const chunk = toChunk(part, signal);
				if (!chunk) continue;
				yield chunk;
				if (chunk.type === "finish" || chunk.type === "error") return;
			}
			yield {
				type: "error",
				error: {
					code: "network",
					message: "the stream ended without a finish",
				},
			};
		} catch (error) {
			yield { type: "error", error: toProviderError(error, signal) };
		}
	}

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
