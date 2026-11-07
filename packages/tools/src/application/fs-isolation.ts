import {
	FsEditInputSchema,
	FsWriteInputSchema,
	ok,
	type Result,
	type ToolContext,
	type ToolError,
	type ToolIsolation,
	type ToolIsolationAdapter,
	type ToolIsolationInput,
	ToolIsolationInputSchema,
} from "@mete/contracts";
import { type FsDeps, parse, placeToChange, scoped } from "./fs-common.js";

const workspace = (): Result<ToolIsolation, ToolError> =>
	ok({ scope: "workspace" });

const supports = (deps: FsDeps, call: ToolIsolationInput) =>
	call.adapterId === deps.adapterId &&
	["fs.write@1", "fs.edit@1"].includes(call.capability);

const confinement = async (
	deps: FsDeps,
	path: string,
	ctx: ToolContext,
): Promise<Result<ToolIsolation, ToolError>> => {
	const scope = await scoped(deps, ctx);
	if (!scope.ok) return workspace();
	const at = await placeToChange(scope.value, path);
	if (!at.ok) return at.error.code === "bad_input" ? at : workspace();
	return ok({ scope: "worktree", root: scope.value.workspaceDir });
};

/** Describes only native writes proven confined to a scoped worktree (ADR-181). */
export const createFsIsolation = (deps: FsDeps): ToolIsolationAdapter => ({
	async inspect(input, signal) {
		const parsed = parse(ToolIsolationInputSchema, input);
		if (!parsed.ok) return parsed;
		const call = parsed.value;
		if (!supports(deps, call)) return workspace();
		const args =
			call.capability === "fs.write@1"
				? parse(FsWriteInputSchema, call.input)
				: parse(FsEditInputSchema, call.input);
		if (!args.ok) return args;
		if (call.cwd === undefined) return workspace();
		return confinement(deps, args.value.path, { cwd: call.cwd, signal });
	},
});
