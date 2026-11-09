import {
	type EngineError,
	err,
	type Result,
	type RunSkillsAdapter,
	RunSkillsStartInputSchema,
} from "@mete/contracts";
import { z } from "zod";

type Start = (
	req: z.infer<typeof RunSkillsStartInputSchema>,
) => Promise<Result<{ runId: string }, EngineError>>;

/** run.skills@1: `start` validates the S2 input then shares the native engine start. */
export const createRunSkills = (
	start: Start,
	read: RunSkillsAdapter["read"],
): RunSkillsAdapter => ({
	start: async (input) => {
		const parsed = RunSkillsStartInputSchema.safeParse(input);
		if (!parsed.success)
			return err({ code: "bad_input", message: z.prettifyError(parsed.error) });
		return start(parsed.data);
	},
	read,
});
