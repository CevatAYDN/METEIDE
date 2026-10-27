import { z } from "zod";

// What team.engine@2 `transcript` and `mete/run.transcript` answer (ADR-125): the steps of a run's
// saved conversation, masked when read. Events carry none of this (docs/07).

const ToolStepSchema = z.strictObject({
	name: z.string().min(1),
	/** The call's arguments as JSON text. */
	args: z.string(),
	/** The value as JSON or the error's message; no `ok` when the content was no stored result. */
	result: z
		.strictObject({ ok: z.boolean().optional(), text: z.string() })
		.optional(),
});

const StepSchema = z.strictObject({
	text: z.string().optional(),
	toolCalls: z.array(ToolStepSchema),
	/** A user message after the opening: the summary of earlier turns, or feedback and repairs. */
	from: z.enum(["summary", "user"]).optional(),
});

/** One step: an assistant message with its tool calls, or a later user message. */
export type TranscriptStep = z.infer<typeof StepSchema>;

/** A run's conversations: the single agent's, or one per task and running review (ADR-125). */
export const TranscriptSchema = z.strictObject({
	runId: z.string().min(1),
	conversations: z.array(
		z.strictObject({
			taskId: z.string().min(1).optional(),
			roleId: z.string().min(1),
			steps: z.array(StepSchema),
		}),
	),
});

/** What `TranscriptSchema` parses. */
export type Transcript = z.infer<typeof TranscriptSchema>;
