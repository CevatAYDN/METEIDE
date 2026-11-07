import { ChatRequestSchema, TaskPendingSchema } from "@mete/contracts";
import { z } from "zod";
import { TaskSessionSchema } from "./task-session-schema.js";

/** Persistent, masked request plus the task state it was created for. */
export const TaskWaitSchema = z.strictObject({
	request: TaskPendingSchema,
	signature: z.string().min(1),
	stage: z.enum(["tool", "verify", "setup", "human", "merge"]),
});

/** A coordinator conversation suspended while another task can work. */
export const TaskContinuationSchema = z.strictObject({
	messages: z.array(ChatRequestSchema.shape.messages.element),
	session: TaskSessionSchema,
	review: z.string().optional(),
	clarify: z.string().optional(),
	judge: z.boolean().optional(),
});
