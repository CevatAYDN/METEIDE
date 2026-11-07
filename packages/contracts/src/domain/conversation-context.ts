import { z } from "zod";
import {
	CONTEXT_ATTACHMENT_BYTES,
	CONTEXT_ATTACHMENT_COUNT,
	CONTEXT_PATH_CHARS,
	CONTEXT_TOTAL_BYTES,
} from "../defaults.js";
import type {
	ConversationThreadAdapter,
	ThreadStarted,
} from "./conversation-thread.js";
import {
	ThreadReplyInputSchema,
	ThreadStartInputSchema,
} from "./conversation-thread.js";
import type { EngineError } from "./engine.js";
import { IdSchema } from "./ids.js";
import type { Result } from "./result.js";
import type { ToolError } from "./tools.js";

const encoder = new TextEncoder();
const unicodeText = (text: string) =>
	!text.includes("\0") &&
	new TextDecoder("utf-8", { ignoreBOM: true }).decode(encoder.encode(text)) ===
		text;
const path = z
	.string()
	.min(1)
	.max(CONTEXT_PATH_CHARS)
	.refine(
		(value) => unicodeText(value) && !/[\r\n]/u.test(value),
		"invalid context source path",
	);
const position = z.strictObject({
	line: z.number().int().nonnegative(),
	character: z.number().int().nonnegative(),
});
const relativePath = path.refine(
	(value) =>
		!value.includes("\\") &&
		!value.includes(":") &&
		value
			.split("/")
			.every((part) => part !== "" && part !== "." && part !== ".."),
	"context source must be a canonical workspace-relative path",
);

/** Editor positions are zero-based UTF-16, with an exclusive end (ADR-183). */
export const ContextRangeSchema = z
	.strictObject({
		start: position,
		end: position,
	})
	.refine(
		({ start, end }) =>
			start.line < end.line ||
			(start.line === end.line && start.character < end.character),
		"context selection must be nonempty and ordered",
	);
/** Raw explicitly chosen editor data; never a trusted disk-content attestation. */
export const ContextDraftSchema = z.strictObject({
	path,
	content: z
		.string()
		.min(1)
		.max(CONTEXT_ATTACHMENT_BYTES)
		.refine(
			(value) =>
				unicodeText(value) &&
				encoder.encode(value).byteLength <= CONTEXT_ATTACHMENT_BYTES,
			"invalid or oversized context text",
		),
	modified: z.boolean(),
	range: ContextRangeSchema.optional(),
});
/** Masked preview identity; SHA-256 is integrity metadata, not authorization. */
export const ContextSnapshotSchema = ContextDraftSchema.extend({
	path: relativePath,
	sha256: z.string().regex(/^[a-f0-9]{64}$/u),
});
/** All selected snapshots for one turn, bounded without silent trimming. */
export const ContextAttachmentsSchema = z
	.array(ContextSnapshotSchema)
	.max(CONTEXT_ATTACHMENT_COUNT)
	.refine(
		(items) =>
			items.reduce(
				(sum, item) => sum + encoder.encode(item.content).byteLength,
				0,
			) <= CONTEXT_TOTAL_BYTES,
		"context attachments exceed the combined byte limit",
	);
/** A source check never accepts caller-owned filesystem roots or permissions. */
export const FsContextInputSchema = z.strictObject({ path });
/** Native inspection returns only a canonical path, never file contents. */
export const FsContextOutputSchema = z.strictObject({ path: relativePath });
/** Additive versioned start; @1 schemas remain unchanged. */
export const ThreadContextStartInputSchema = ThreadStartInputSchema.extend({
	attachments: ContextAttachmentsSchema.default([]),
});
/** Additive versioned reply preserves exact head and request identity. */
export const ThreadContextReplyInputSchema = ThreadReplyInputSchema.extend({
	attachments: ContextAttachmentsSchema.default([]),
});
/** The selected immutable turn's sent context, empty for legacy runs. */
export const ThreadContextReadResultSchema = z.strictObject({
	runId: IdSchema,
	attachments: ContextAttachmentsSchema,
});

export type ContextDraft = z.infer<typeof ContextDraftSchema>;
export type ContextSnapshot = z.infer<typeof ContextSnapshotSchema>;
export type ContextRange = z.infer<typeof ContextRangeSchema>;
export type FsContextInput = z.infer<typeof FsContextInputSchema>;
export type FsContextOutput = z.infer<typeof FsContextOutputSchema>;
export type ThreadContextStartInput = z.input<
	typeof ThreadContextStartInputSchema
>;
export type ThreadContextReplyInput = z.input<
	typeof ThreadContextReplyInputSchema
>;
export type ThreadContextReadResult = z.infer<
	typeof ThreadContextReadResultSchema
>;

/** Native source eligibility, never a model-callable tool (ADR-183). */
export interface FsContextAdapter {
	inspect(
		input: FsContextInput,
		signal: AbortSignal,
	): Promise<Result<FsContextOutput, ToolError>>;
}
/** Explicit snapshots over the existing immutable conversation identity (ADR-183). */
export interface ConversationThreadV2Adapter
	extends Omit<ConversationThreadAdapter, "start" | "reply"> {
	prepare(input: ContextDraft): Promise<Result<ContextSnapshot, EngineError>>;
	start(
		input: ThreadContextStartInput,
	): Promise<Result<ThreadStarted, EngineError>>;
	reply(
		input: ThreadContextReplyInput,
	): Promise<Result<ThreadStarted, EngineError>>;
	context(input: {
		runId: string;
	}): Promise<Result<ThreadContextReadResult, EngineError>>;
}
