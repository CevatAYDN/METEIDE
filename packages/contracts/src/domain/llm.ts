import { z } from "zod";
import { IdSchema } from "./ids.js";
import {
	type ChatChunk,
	ChatRequestSchema,
	type EmbedRequest,
	type EmbedResponse,
	type ProviderError,
} from "./provider.js";
import type { Result } from "./result.js";

// llm.chat@2 and llm.embed@1 from docs/06 (Kernel API) and docs/09 (Gateway, Privacy).

const text = z.string().min(1);

/** A model tier (docs/09, Model tiers). */
export const TierSchema = z.enum([
	"reasoning",
	"coder",
	"fast",
	"long-context",
	"vision",
]);

/** A model tier. */
export type Tier = z.infer<typeof TierSchema>;

/** A model feature a caller needs (docs/09, Model tiers). */
export const NeedSchema = z.enum(["tool_calling", "vision", "long_context"]);

/** One exact model of one provider. */
export const ModelRefSchema = z.strictObject({
	providerId: text,
	modelId: text,
});

/** One exact model of one provider. */
export type ModelRef = z.infer<typeof ModelRefSchema>;

/** Input of llm.chat@2: a tier or one exact model instead of `model`. */
export const LlmChatRequestSchema = ChatRequestSchema.omit({
	model: true,
}).extend({
	target: z.union([z.strictObject({ tier: TierSchema }), ModelRefSchema]),
	runId: IdSchema,
	priority: z.union([z.literal(0), z.literal(1), z.literal(2)]),
	needs: z.array(NeedSchema).optional(),
	avoidFamilies: z.array(text).optional(),
	/** The role's pinned model, first in a tier's chain when it is a candidate (ADR-077). */
	prefer: ModelRefSchema.optional(),
});

/** What a caller asks llm.chat@2. */
export type LlmChatRequest = z.infer<typeof LlmChatRequestSchema>;

/**
 * Why a routed call failed; `no_model`, `too_large` and `quota_exhausted` pause the run. @2 (ADR-056)
 * adds `too_large`: no model of the chain can take a request this large; its message names the estimate.
 */
export type LlmError =
	| ProviderError
	| { readonly code: "no_model"; readonly message: string }
	| { readonly code: "too_large"; readonly message: string }
	| {
			readonly code: "quota_exhausted";
			readonly message: string;
			readonly resumesAt: string;
	  };

/** One streamed piece; a `model` chunk comes before the first chunk of every model used. */
export type LlmChunk =
	| Exclude<ChatChunk, { type: "error" }>
	| {
			readonly type: "model";
			readonly providerId: string;
			readonly modelId: string;
			readonly reason: "first" | "quota" | "failed";
	  }
	| { readonly type: "error"; readonly error: LlmError };

/** The gateway's adapter behind llm.chat@2. */
export interface LlmChatAdapter {
	chat(req: LlmChatRequest, signal: AbortSignal): AsyncIterable<LlmChunk>;
}

/** What a caller asks llm.embed@1: no tier and no pin, the embedding models the model mode and privacy allow (ADR-152). */
export type LlmEmbedRequest = Omit<EmbedRequest, "model"> &
	Pick<LlmChatRequest, "runId" | "priority">;

/** The vectors and the model that made them, which stored vectors keep (docs/11, Indexing). */
export type LlmEmbedResponse = EmbedResponse & { readonly model: ModelRef };

/** The gateway's adapter behind llm.embed@1 (docs/09, Gateway; ADR-152). */
export interface LlmEmbedAdapter {
	embed(
		req: LlmEmbedRequest,
		signal: AbortSignal,
	): Promise<Result<LlmEmbedResponse, LlmError>>;
}

/** The `privacy:` section of settings.yaml (docs/09, Privacy). */
export const PrivacyConfigSchema = z
	.strictObject({ allowTraining: z.boolean().default(false) })
	.prefault({});

/** The user's privacy settings. */
export type PrivacyConfig = z.infer<typeof PrivacyConfigSchema>;
