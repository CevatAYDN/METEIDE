import {
	ChatRequestSchema,
	IdSchema,
	TaskStatusSchema,
	TeamTemplateSchema,
} from "@mete/contracts";
import { z } from "zod";
import { AttemptsSchema } from "./attempts-schema.js";
import { TaskSessionSchema } from "./task-session-schema.js";

const TaskContextSchema = z.strictObject({
	revisionLimit: z.number().int().nonnegative(),
	revisions: z.number().int().nonnegative(),
	pairTurns: z.number().int().nonnegative().optional(),
	agentId: z.string().optional(),
	worktree: z.string().optional(),
	report: z.string().optional(),
	feedback: z.string().optional(),
	blocked: z
		.enum([
			"clarification",
			"capability_missing",
			"guardrail",
			"revision_limit",
		])
		.optional(),
	clarify: z.enum(["asking", "asked"]).optional(),
});

const TaskEntrySchema = z.strictObject({
	/** The Task entity's id (docs/07); events name the task by it. */
	id: IdSchema,
	status: TaskStatusSchema,
	context: TaskContextSchema,
	/** The task's conversation, kept while another task works. */
	messages: z.array(ChatRequestSchema.shape.messages.element),
	/** The worker's execution state, separate from the run-level coordinator conversation. */
	session: TaskSessionSchema.optional(),
	/** Who approved the current submission: approver roles, "human" or "system". */
	approvals: z.array(z.string()),
	/** Guardrail repairs asked in the current attempt (docs/08, step 4). */
	repairs: z.number().int().nonnegative(),
	/** The lesson asked after approval (docs/08, step 8): written, or skipped for good. */
	lesson: z.enum(["written", "skipped"]).optional(),
	/** The Artifact (docs/07) of the task's expected_output, once submitted. */
	artifact: z
		.strictObject({
			id: IdSchema,
			type: z.string().min(1),
			path: z.string().min(1),
			sha256: z.string().min(1),
			createdBy: z.string().min(1),
			createdAt: z.string().min(1),
		})
		.optional(),
	/** A best-of-N task's finished attempts and the live one's id (ADR-162). */
	attempts: AttemptsSchema.optional(),
});

/** A team run's state as the run snapshot keeps it; checked on load like the rest. */
export const TeamStateSchema = z.strictObject({
	template: TeamTemplateSchema,
	tasks: z.record(z.string(), TaskEntrySchema),
});

/** A team run's state. */
export type TeamState = z.output<typeof TeamStateSchema>;
