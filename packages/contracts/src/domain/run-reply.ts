import { z } from "zod";
import type { EngineError } from "./engine.js";
import type { Result } from "./result.js";

/** run.reply@1: continue a completed single-agent conversation without reopening its run. */
export const RunReplyInputSchema = z.strictObject({
	runId: z.string().min(1),
	message: z.string().trim().min(1),
});

export const RunReplyOutputSchema = z.strictObject({
	runId: z.string().min(1),
});

export type RunReplyInput = z.infer<typeof RunReplyInputSchema>;
export type RunReplyOutput = z.infer<typeof RunReplyOutputSchema>;

/** The engine reads trusted saved history; callers supply only the new user message. */
export interface RunReplyAdapter {
	reply(input: RunReplyInput): Promise<Result<RunReplyOutput, EngineError>>;
}
