import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import {
	type ChatChunk,
	type ChatRequest,
	type ModelInfo,
	ok,
	type ProviderError,
	type Result,
} from "@mete/contracts";
import { z } from "zod";
import { fetchJson } from "./model-list.js";
import { streamChat } from "./sdk-chat.js";

// Custom endpoints in the anthropic-messages and google-gemini formats (docs/09, observe()
// rules: how these endpoints list models).

/** Where and how to reach one endpoint. */
export type EndpointCall = {
	readonly providerId: string;
	readonly baseUrl: string;
	readonly apiKey: string;
	readonly headers: Record<string, string>;
	readonly fetch?: typeof globalThis.fetch | undefined;
};

const ANTHROPIC_VERSION = "2023-06-01";

const AnthropicListSchema = z.object({
	data: z.array(
		z.object({
			id: z.string().min(1),
			max_input_tokens: z.number().int().nonnegative().nullish(),
			capabilities: z
				.object({ image_input: z.object({ supported: z.boolean() }).nullish() })
				.nullish(),
			lifecycle: z.string().nullish(),
		}),
	),
});

const GoogleListSchema = z.object({
	models: z
		.array(
			z.object({
				name: z.string().min(1),
				inputTokenLimit: z.number().int().nonnegative().nullish(),
				supportedGenerationMethods: z.array(z.string()).nullish(),
			}),
		)
		.default([]),
});

const info = (
	providerId: string,
	id: string,
	contextWindow: number,
): ModelInfo => ({
	id,
	providerId,
	family: "",
	contextWindow,
	toolCalling: "unknown",
	vision: "unknown",
	free: false,
	deprecated: false,
});

/** Models an anthropic-messages endpoint lists (first page). */
export const listAnthropicModels = async (
	e: EndpointCall,
	signal: AbortSignal,
): Promise<Result<ModelInfo[], ProviderError>> => {
	const list = await fetchJson(
		`${e.baseUrl}/models?limit=1000`,
		e.apiKey,
		signal,
		{
			schema: AnthropicListSchema,
			fetch: e.fetch,
			headers: e.headers,
			auth: { "x-api-key": e.apiKey, "anthropic-version": ANTHROPIC_VERSION },
		},
	);
	if (!list.ok) return list;
	return ok(
		list.value.data.map((m) => ({
			...info(e.providerId, m.id, m.max_input_tokens ?? 0),
			vision: m.capabilities?.image_input?.supported ?? "unknown",
			deprecated: (m.lifecycle ?? "active") !== "active",
		})),
	);
};

/** Models a google-gemini endpoint lists (first page) that can generate content. */
export const listGoogleModels = async (
	e: EndpointCall,
	signal: AbortSignal,
): Promise<Result<ModelInfo[], ProviderError>> => {
	const list = await fetchJson(
		`${e.baseUrl}/models?pageSize=1000`,
		e.apiKey,
		signal,
		{
			schema: GoogleListSchema,
			fetch: e.fetch,
			headers: e.headers,
			auth: { "x-goog-api-key": e.apiKey },
		},
	);
	if (!list.ok) return list;
	return ok(
		list.value.models
			.filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
			.map((m) =>
				info(
					e.providerId,
					m.name.replace(/^models\//, ""),
					m.inputTokenLimit ?? 0,
				),
			),
	);
};

const sdkOptions = (e: EndpointCall) => ({
	baseURL: e.baseUrl,
	apiKey: e.apiKey,
	headers: e.headers,
	...(e.fetch ? { fetch: e.fetch } : {}),
});

/** Chat for an anthropic-messages endpoint. */
export const anthropicChat = (e: EndpointCall) => {
	const provider = createAnthropic(sdkOptions(e));
	return (req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatChunk> =>
		streamChat(() => provider.languageModel(req.model), req, signal);
};

/** Chat for a google-gemini endpoint. */
export const googleChat = (e: EndpointCall) => {
	const provider = createGoogle(sdkOptions(e));
	return (req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatChunk> =>
		streamChat(() => provider.languageModel(req.model), req, signal);
};
