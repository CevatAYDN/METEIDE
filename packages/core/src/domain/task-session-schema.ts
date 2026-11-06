import { z } from "zod";

/** A task attempt's persisted worker state, independent of coordinator conversations. */
export const TaskSessionSchema = z.strictObject({
	agent: z
		.strictObject({
			id: z.string().min(1),
			roleId: z.string().optional(),
			providerId: z.string().min(1),
			modelId: z.string().min(1),
			family: z.string().optional(),
			contextWindow: z.number().int().positive().optional(),
		})
		.optional(),
	turns: z.number().int().nonnegative(),
	checkpointed: z.number().int(),
	snapshot: z.string().optional(),
	/** A writing call recorded before dispatch, so recovery never repeats an uncertain write (ADR-177). */
	inFlight: z.string().optional(),
	tainted: z.boolean(),
});

export type TaskSession = z.output<typeof TaskSessionSchema>;

export const freshTaskSession = (): TaskSession => ({
	turns: 0,
	checkpointed: -1,
	tainted: false,
});
