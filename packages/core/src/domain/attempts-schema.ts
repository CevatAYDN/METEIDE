import { ChatRequestSchema, IdSchema } from "@mete/contracts";
import { z } from "zod";

// How the run snapshot keeps a best-of-N task's attempts (ADR-162); domain/attempts.ts moves them.

const MessageSchema = ChatRequestSchema.shape.messages.element;

const FinishedSchema = z.strictObject({
	/** Names the attempt's worktree and branch: the task's id for the first, an id of its own after. */
	id: IdSchema,
	agentId: z.string(),
	messages: z.array(MessageSchema),
	/** The report, when the attempt's verify gates and guardrail passed. */
	report: z.string().optional(),
	worktree: z.string().optional(),
	/** The family of the model it last ran on, which made its report (ADR-162). */
	family: z.string().optional(),
});

/** A best-of-N task's attempts, as the run snapshot keeps them. */
export const AttemptsSchema = z.strictObject({
	/** The live attempt's id when it is not the task's own (attempt 2 on). */
	id: IdSchema.optional(),
	/** How the work opened after the questions before it, which every later attempt opens with. */
	opening: z.array(MessageSchema).optional(),
	finished: z.array(FinishedSchema),
	/** The attempt that goes on (1-based): the chosen one, or the last when none passed. */
	goesOn: z.number().int().positive().optional(),
});
