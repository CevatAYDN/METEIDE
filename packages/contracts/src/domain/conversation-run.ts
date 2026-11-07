import { z } from "zod";
import type { EngineError } from "./engine.js";
import { ModelRefSchema } from "./llm.js";
import type { Result } from "./result.js";

/** Optional conversation tool groups approved by ADR-180; baseline tools stay implicit. */
export const ConversationCapabilitySchema = z.enum([
	"web.search@1",
	"web.fetch@1",
	"mcp.tools@1",
]);

/** One optional capability selected by the human for a single-agent conversation. */
export type ConversationCapability = z.infer<
	typeof ConversationCapabilitySchema
>;

/** Explicit selections contain each approved capability at most once. */
export const ConversationCapabilitiesSchema = z
	.array(ConversationCapabilitySchema)
	.refine((refs) => new Set(refs).size === refs.length, {
		message: "conversation capabilities must be unique",
	});

/** conversation.run@1 start: bypass team routing, with optional model preference. */
export const ConversationStartInputSchema = z.strictObject({
	goal: z.string().trim().min(1),
	prefer: ModelRefSchema.optional(),
	capabilities: ConversationCapabilitiesSchema.default([]),
});

/** Omit capabilities on reply to inherit the completed predecessor's selection. */
export const ConversationReplyInputSchema = z.strictObject({
	runId: z.string().min(1),
	message: z.string().trim().min(1),
	capabilities: ConversationCapabilitiesSchema.optional(),
});

/** A new immutable run begins each conversation turn. */
export const ConversationRunOutputSchema = z.strictObject({
	runId: z.string().min(1),
});

/** Unparsed start input; capabilities default to no extras. */
export type ConversationStartInput = z.input<
	typeof ConversationStartInputSchema
>;
/** A follow-up message with an optional replacement selection. */
export type ConversationReplyInput = z.input<
	typeof ConversationReplyInputSchema
>;
/** The identity of the newly started conversation run. */
export type ConversationRunOutput = z.infer<typeof ConversationRunOutputSchema>;

/** Explicit tool selection without changing team.engine@2 or run.reply@1. */
export interface ConversationRunAdapter {
	start(
		input: ConversationStartInput,
	): Promise<Result<ConversationRunOutput, EngineError>>;
	reply(
		input: ConversationReplyInput,
	): Promise<Result<ConversationRunOutput, EngineError>>;
}
