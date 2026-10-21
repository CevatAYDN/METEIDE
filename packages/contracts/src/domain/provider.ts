import { z } from "zod";
import type { QuotaObservation, QuotaUnitSpec } from "./quota.js";
import type { Result } from "./result.js";

// provider.chat@1, provider.embed@1 and provider.rerank@1 from docs/06 (Kernel API)
// and docs/09 (Provider adapter).

const text = z.string().min(1);

const ToolCallSchema = z.strictObject({
	id: text,
	name: text,
	args: z.unknown(),
});

/** A tool call the model asked for. */
export type ToolCall = z.infer<typeof ToolCallSchema>;

const ContentPartSchema = z.discriminatedUnion("type", [
	z.strictObject({ type: z.literal("text"), text: z.string() }),
	z.strictObject({
		type: z.literal("image"),
		mediaType: text,
		data: z.base64(),
	}),
]);

/** Text or a base64 image inside a user message. */
export type ContentPart = z.infer<typeof ContentPartSchema>;

const ChatMessageSchema = z.discriminatedUnion("role", [
	z.strictObject({ role: z.literal("system"), content: z.string() }),
	z.strictObject({
		role: z.literal("user"),
		content: z.union([z.string(), z.array(ContentPartSchema).min(1)]),
	}),
	z.strictObject({
		role: z.literal("assistant"),
		content: z.string(),
		toolCalls: z.array(ToolCallSchema).optional(),
	}),
	z.strictObject({
		role: z.literal("tool"),
		toolCallId: text,
		content: z.string(),
	}),
]);

/** One message of a conversation. */
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

const ToolSpecSchema = z.strictObject({
	name: text,
	description: z.string(),
	parameters: z.unknown(),
});

/** A tool the model may call; `parameters` is a JSON Schema. */
export type ToolSpec = z.infer<typeof ToolSpecSchema>;

/** Input of `chat`. */
export const ChatRequestSchema = z.strictObject({
	model: text,
	messages: z.array(ChatMessageSchema).min(1),
	tools: z.array(ToolSpecSchema).optional(),
	maxTokens: z.number().int().positive().optional(),
	temperature: z.number().min(0).optional(),
});

/** What a caller asks provider.chat@1. */
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

/** A provider failure; `status` and `headers` go to `observe()`. */
export type ProviderError = {
	readonly code:
		| "rate_limited"
		| "unauthorized"
		| "bad_request"
		| "server"
		| "network"
		| "aborted";
	readonly message: string;
	readonly status?: number;
	readonly headers?: Headers;
};

/** One streamed piece; a stream ends with exactly one `finish` or one `error`. */
export type ChatChunk =
	| { readonly type: "text"; readonly text: string }
	| {
			readonly type: "tool-call";
			readonly id: string;
			readonly name: string;
			readonly args: unknown;
	  }
	| {
			readonly type: "finish";
			readonly reason:
				| "stop"
				| "length"
				| "tool-calls"
				| "content-filter"
				| "other";
			readonly usage: { readonly prompt: number; readonly completion: number };
	  }
	| { readonly type: "error"; readonly error: ProviderError };

/** Input and output of `embed`: one vector per input, in order. */
export type EmbedRequest = {
	readonly model: string;
	readonly input: readonly string[];
	/** Search queries and indexed documents are embedded differently by some models. */
	readonly purpose: "query" | "document";
};
export type EmbedResponse = {
	readonly vectors: readonly (readonly number[])[];
};

/** Input and output of `rerank`: one score per document, in order. */
export type RerankRequest = {
	readonly model: string;
	readonly query: string;
	readonly documents: readonly string[];
};
export type RerankResponse = { readonly scores: readonly number[] };

const known = z.union([z.boolean(), z.literal("unknown")]);

/** A discovered model (docs/09); a model without facts has `contextWindow: 0`. */
export const ModelInfoSchema = z.strictObject({
	id: text,
	providerId: text,
	family: z.string(),
	contextWindow: z.number().int().nonnegative(),
	toolCalling: known,
	vision: known,
	free: z.boolean(),
	deprecated: z.boolean(),
});

/** A model a provider offers. */
export type ModelInfo = z.infer<typeof ModelInfoSchema>;

/** What a provider does with prompts sent to a model. */
export const PrivacySchema = z.strictObject({
	trains: known,
	logs: known,
	publishes: known,
});

/** A model's privacy facts. */
export type Privacy = z.infer<typeof PrivacySchema>;

/** The adapter behind provider.chat@1, provider.embed@1 and provider.rerank@1. */
export interface ProviderAdapter {
	/** "nvidia", "openrouter", "opencode-zen" or "custom:<slug>". */
	readonly id: string;
	readonly format: "openai-chat" | "anthropic-messages" | "google-gemini";
	listModels(signal: AbortSignal): Promise<Result<ModelInfo[], ProviderError>>;
	chat(req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatChunk>;
	embed?(
		req: EmbedRequest,
		signal: AbortSignal,
	): Promise<Result<EmbedResponse, ProviderError>>;
	rerank?(
		req: RerankRequest,
		signal: AbortSignal,
	): Promise<Result<RerankResponse, ProviderError>>;
	quotaUnits(): QuotaUnitSpec[];
	/** Reads rate-limit headers and 429s. */
	observe(status: number, headers: Headers): QuotaObservation[];
	privacy(model: ModelInfo): Privacy;
}

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** One custom endpoint from the `providers:` section; its key is in the keychain (docs/09). */
const CustomEndpointSchema = z.strictObject({
	slug: z.string().regex(SLUG, "expected a kebab-case slug"),
	name: text,
	baseUrl: z.url(),
	format: z.enum(["openai-chat", "anthropic-messages", "google-gemini"]),
	headers: z.record(z.string(), z.string()).default(() => ({})),
});

/** A custom endpoint. */
export type CustomEndpoint = z.infer<typeof CustomEndpointSchema>;

/** The `providers:` section of settings.yaml; each slug appears once. */
export const ProvidersConfigSchema = z
	.strictObject({
		custom: z
			.array(CustomEndpointSchema)
			.readonly()
			.default(() => []),
	})
	.superRefine((c, ctx) => {
		const seen = new Set<string>();
		c.custom.forEach((e, i) => {
			if (seen.has(e.slug))
				ctx.addIssue({
					code: "custom",
					path: ["custom", i, "slug"],
					message: "a slug MUST appear once",
				});
			seen.add(e.slug);
		});
	})
	.prefault({});

/** The user's provider settings. */
export type ProvidersConfig = z.infer<typeof ProvidersConfigSchema>;
