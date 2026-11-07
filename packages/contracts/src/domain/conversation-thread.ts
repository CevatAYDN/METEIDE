import { z } from "zod";
import { THREAD_LIST_LIMIT, THREAD_LIST_MAX } from "../defaults.js";
import {
	ConversationCapabilitiesSchema,
	ConversationStartInputSchema,
} from "./conversation-run.js";
import { RunViewSchema } from "./daemon.js";
import type { EngineError } from "./engine.js";
import { IdSchema, TimestampSchema } from "./ids.js";
import type { Result } from "./result.js";

/** A new conversation intent, distinct from legacy non-idempotent starts (ADR-182). */
export const ThreadStartInputSchema = ConversationStartInputSchema.extend({
	requestId: IdSchema,
});
/** Exact head and intent identity; the server alone owns the predecessor's history. */
export const ThreadReplyInputSchema = z.strictObject({
	conversationId: IdSchema,
	expectedRunId: IdSchema,
	requestId: IdSchema,
	message: z.string().trim().min(1),
	capabilities: ConversationCapabilitiesSchema.optional(),
});
/** The durable result reused when an identical intent is retried. */
export const ThreadStartedSchema = z.strictObject({
	conversationId: IdSchema,
	runId: IdSchema,
});
/** Stable descending list boundary, scoped to the caller's current search. */
export const ThreadCursorSchema = z.strictObject({
	updatedAt: TimestampSchema,
	id: IdSchema,
});
/** Local conversation search and bounded paging (ADR-182). */
export const ThreadListInputSchema = z.strictObject({
	query: z.string().trim().default(""),
	limit: z
		.number()
		.int()
		.positive()
		.max(THREAD_LIST_MAX)
		.default(THREAD_LIST_LIMIT),
	cursor: ThreadCursorSchema.optional(),
});
/** One conversation, retaining the current run's existing controls and status. */
export const ConversationThreadSchema = z.strictObject({
	id: IdSchema,
	title: z.string(),
	head: RunViewSchema.refine(
		(run) => run.templateId === null,
		"team runs are not conversations",
	),
	createdAt: TimestampSchema,
	updatedAt: TimestampSchema,
	turnCount: z.number().int().positive(),
});
/** A page of matching conversation summaries, never unmasked transcript text. */
export const ThreadListResultSchema = z.strictObject({
	conversations: z.array(ConversationThreadSchema),
	nextCursor: ThreadCursorSchema.optional(),
});
/** Resolves the selected run's conversation without guessing from its title. */
export const ThreadReadInputSchema = z.strictObject({ runId: IdSchema });
/** Ordered retained runs remain individually inspectable. */
export const ThreadReadResultSchema = z
	.strictObject({
		conversation: ConversationThreadSchema,
		turns: z.array(RunViewSchema).min(1),
	})
	.refine(
		({ conversation, turns }) =>
			turns.length === conversation.turnCount &&
			new Set(turns.map((turn) => turn.id)).size === turns.length &&
			turns.at(-1)?.id === conversation.head.id &&
			turns.every(
				(turn) =>
					turn.templateId === null &&
					turn.workspaceId === conversation.head.workspaceId,
			),
		"turn history must contain unique runs from the same workspace ending at its head",
	);

export type ThreadStartInput = z.input<typeof ThreadStartInputSchema>;
export type ThreadReplyInput = z.input<typeof ThreadReplyInputSchema>;
export type ThreadStarted = z.infer<typeof ThreadStartedSchema>;
export type ThreadCursor = z.infer<typeof ThreadCursorSchema>;
export type ThreadListInput = z.input<typeof ThreadListInputSchema>;
export type ConversationThread = z.infer<typeof ConversationThreadSchema>;
export type ThreadListResult = z.infer<typeof ThreadListResultSchema>;
export type ThreadReadInput = z.input<typeof ThreadReadInputSchema>;
export type ThreadReadResult = z.infer<typeof ThreadReadResultSchema>;

/** Stable conversation identity with immutable run history (ADR-182). */
export interface ConversationThreadAdapter {
	start(input: ThreadStartInput): Promise<Result<ThreadStarted, EngineError>>;
	reply(input: ThreadReplyInput): Promise<Result<ThreadStarted, EngineError>>;
	list(input: ThreadListInput): Promise<Result<ThreadListResult, EngineError>>;
	read(input: ThreadReadInput): Promise<Result<ThreadReadResult, EngineError>>;
}
