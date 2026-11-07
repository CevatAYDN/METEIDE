import { lstat, stat } from "node:fs/promises";
import { join } from "node:path";
import { err, type Result, type ToolError } from "@mete/contracts";
import { contextAttempt } from "./context-source.js";
import { type IgnoreCheck, loadIgnore } from "./ignore-rules.js";

/** Context never treats dangling or nonregular ignore rules as an absent rule file (ADR-183). */
export const contextIgnoreRules = async (
	root: string,
	signal: AbortSignal,
): Promise<Result<IgnoreCheck, ToolError>> => {
	const file = join(root, ".meteignore");
	const entry = await contextAttempt(() => lstat(file), signal);
	if (!entry.ok && entry.error.code !== "not_found") return entry;
	if (entry.ok) {
		const target = await contextAttempt(() => stat(file), signal);
		if (!target.ok || !target.value.isFile())
			return err({
				code: "io",
				message: "Context ignore rules cannot be read",
			});
	}
	signal.throwIfAborted();
	return loadIgnore(root, root);
};
