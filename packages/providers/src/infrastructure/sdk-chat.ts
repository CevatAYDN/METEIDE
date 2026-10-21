import type { OpenAICompatibleProvider } from "@ai-sdk/openai-compatible";
import type { ChatChunk, ChatRequest, ProviderError } from "@mete/contracts";
import { z } from "zod";
import { codeForStatus } from "../domain/errors.js";
import { type CallOptions, toPrompt, toTools } from "./openai-prompt.js";

// One AI SDK chat model streamed as ChatChunks (docs/06, provider types): every
// format's SDK model has the same doStream, so one loop serves them all.

/** An AI SDK chat model; the type comes from the SDK so @ai-sdk/provider is not imported. */
export type ChatModel = Pick<
	ReturnType<OpenAICompatibleProvider["chatModel"]>,
	"doStream"
>;

type StreamPart =
	Awaited<ReturnType<ChatModel["doStream"]>>["stream"] extends ReadableStream<
		infer P
	>
		? P
		: never;

// The SDK's APICallError, read by shape so @ai-sdk/provider is not imported.
const ApiCallErrorSchema = z.object({
	name: z.literal("AI_APICallError"),
	message: z.string(),
	statusCode: z.number().optional(),
	responseHeaders: z.record(z.string(), z.string()).optional(),
});

// The error object a provider sends inside the stream (`{"error": {...}}`), which the SDK
// forwards as a plain object; a numeric code is an HTTP status.
const InBandErrorSchema = z.object({
	message: z.string(),
	code: z.union([z.number(), z.string()]).optional(),
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
	if (error instanceof Error)
		return { code: "network", message: error.message };
	const inBand = InBandErrorSchema.safeParse(error);
	if (!inBand.success) return { code: "network", message: String(error) };
	const { code, message } = inBand.data;
	return {
		code: typeof code === "number" ? codeForStatus(code) : "server",
		message,
	};
};

const parseArgs = (input: string): unknown => {
	try {
		return JSON.parse(input);
	} catch {
		return input; // the tool layer validates arguments and reports the bad call
	}
};

const finish = (part: Extract<StreamPart, { type: "finish" }>): ChatChunk =>
	part.finishReason.raw === "error"
		? {
				type: "error",
				error: {
					code: "server",
					message: "the provider ended the stream with an error",
				},
			}
		: {
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
			return finish(part);
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

/** Streams one chat call; ends with exactly one finish or one error chunk. */
export async function* streamChat(
	model: () => ChatModel,
	req: ChatRequest,
	signal: AbortSignal,
): AsyncIterable<ChatChunk> {
	try {
		if (signal.aborted) throw new Error("aborted");
		const { stream } = await model().doStream(callOptions(req, signal));
		for await (const part of stream) {
			const chunk = toChunk(part, signal);
			if (!chunk) continue;
			yield chunk;
			if (chunk.type === "finish" || chunk.type === "error") return;
		}
		yield {
			type: "error",
			error: { code: "network", message: "the stream ended without a finish" },
		};
	} catch (error) {
		yield { type: "error", error: toProviderError(error, signal) };
	}
}
