import type { ToolContext } from "@mete/contracts";
import { z } from "zod";
import { INSTRUCTION_FILES, workspaceBlock } from "../domain/workspace.js";
import { masked, runCapability, type StepDeps } from "./steps.js";

// Reads the workspace block of a new run once, when it starts (docs/08, Agent context assembly;
// ADR-126), through the registry with the run's tool context, so the policy and .meteignore apply.

const Listed = z.object({ paths: z.array(z.string()) });
const Read = z.object({ content: z.string() });
const quiet = () => {};

const firstFile = async (
	deps: StepDeps,
	ctx: ToolContext,
	names: readonly string[],
) => {
	for (const path of INSTRUCTION_FILES.filter((f) => names.includes(f))) {
		const r = await runCapability(
			deps,
			{ ref: "fs.read@1", input: { path } },
			ctx,
			quiet,
		);
		const read = r.ok ? Read.safeParse(r.value) : undefined;
		if (read?.success) return { path, text: read.data.content };
		const code = r.ok ? "bad_output" : r.error.code;
		deps.logger.warn(
			{ runId: ctx.runId, path, code },
			"workspace file not read",
		);
	}
	return undefined;
};

/** The masked workspace block, or undefined when the top folder could not be listed or is empty. */
export const readWorkspace = async (
	deps: StepDeps,
	runId: string,
): Promise<string | undefined> => {
	const ctx = { runId, signal: new AbortController().signal };
	const input = { path: "." };
	const r = await runCapability(deps, { ref: "fs.list@1", input }, ctx, quiet);
	const listed = r.ok ? Listed.safeParse(r.value) : undefined;
	if (!listed?.success) {
		// A workspace without fs.list@1 simply opens without the block.
		const code = r.ok ? "bad_output" : r.error.code;
		if (code !== "capability_missing")
			deps.logger.warn({ runId, code }, "workspace not listed");
		return undefined;
	}
	const names = listed.data.paths;
	const block = workspaceBlock({
		names,
		file: await firstFile(deps, ctx, names),
	});
	return block === undefined ? undefined : masked(deps, block);
};
