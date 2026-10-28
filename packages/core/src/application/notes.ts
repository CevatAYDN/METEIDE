import type { ToolContext } from "@mete/contracts";
import { z } from "zod";
import { notesBlock, notesQuery } from "../domain/notes.js";
import { masked, runCapability, type StepDeps } from "./steps.js";

// Asks knowledge.search@1 once, when a team task starts, for the lessons its title finds (docs/08,
// Agent context assembly; ADR-151), through the registry with the run's tool context.

const Found = z.object({
	results: z.array(
		z.object({
			path: z.string(),
			title: z.string(),
			heading: z.string().optional(),
			snippet: z.string(),
		}),
	),
});
const quiet = () => {};

/** The masked block of lessons for a task titled `title`, or undefined when none could be found. */
export const readNotes = async (
	deps: StepDeps,
	ctx: ToolContext,
	title: string,
): Promise<string | undefined> => {
	const input = { query: notesQuery(title), type: "lesson" };
	const call = { ref: "knowledge.search@1", input } as const;
	const r = await runCapability(deps, call, ctx, quiet);
	const found = r.ok ? Found.safeParse(r.value) : undefined;
	if (!found?.success) {
		// A workspace without knowledge.search@1 simply opens without the lessons.
		const code = r.ok ? "bad_output" : r.error.code;
		if (code !== "capability_missing")
			deps.logger.warn({ runId: ctx.runId, code }, "lessons not searched");
		return undefined;
	}
	const block = notesBlock(found.data.results);
	return block === undefined ? undefined : masked(deps, block);
};
