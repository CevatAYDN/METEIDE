import { relative, sep } from "node:path";
import {
	err,
	type FsContextAdapter,
	FsContextInputSchema,
	FsContextOutputSchema,
	ok,
} from "@mete/contracts";
import { parse } from "../application/fs-common.js";
import {
	contextFailure,
	contextSourceKind,
	contextSourcePrefix,
} from "./context-source.js";
import { contextPath } from "./fs-context-path.js";

const inspectSource = async (
	workspaceDir: string,
	input: unknown,
	signal: AbortSignal,
): ReturnType<FsContextAdapter["inspect"]> => {
	signal.throwIfAborted();
	const parsed = parse(FsContextInputSchema, input);
	if (!parsed.ok)
		return err({
			code: "bad_input",
			message: "Invalid context source path",
		});
	const path = await contextPath(workspaceDir, parsed.value.path, signal);
	if (!path.ok) return path;
	const source = await contextSourceKind(path.value, signal);
	if (!source.ok) return source;
	const prefix = await contextSourcePrefix(path.value, signal);
	if (!prefix.ok) return prefix;
	signal.throwIfAborted();
	const output = parse(FsContextOutputSchema, {
		path: relative(workspaceDir, path.value).split(sep).join("/"),
	});
	return output.ok
		? ok(output.value)
		: err({ code: "bad_input", message: "Invalid canonical context path" });
};

/** Native editor-context eligibility; no worktree scope or model-tool execution (ADR-183). */
export const createFsContext = (deps: {
	readonly workspaceDir: string;
}): FsContextAdapter => ({
	async inspect(input, signal) {
		try {
			return await inspectSource(deps.workspaceDir, input, signal);
		} catch (error) {
			return err(contextFailure(error));
		}
	},
});
