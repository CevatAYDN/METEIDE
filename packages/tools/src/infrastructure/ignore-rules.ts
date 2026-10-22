import { readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { err, ok, type Result, type ToolError } from "@mete/contracts";
import { withLockRetry } from "@mete/kernel";
import ignore from "ignore";
import { METEIGNORE_DEFAULTS } from "../defaults.js";
import { isInside } from "../domain/paths.js";
import { errnoOf } from "./errno.js";

// `.meteignore` checks (docs/10 Built-in tools, ADR-040): the tab 09 defaults always apply,
// the workspace's file adds lines on top and may re-include a default with "!".

/** Tells whether an absolute path is ignored; folder-only rules ("secrets/") need `folder`. */
export type IgnoreCheck = (path: string, folder?: boolean) => boolean;

const fileLines = async (
	workspaceDir: string,
): Promise<Result<string, ToolError>> => {
	const file = join(workspaceDir, ".meteignore");
	try {
		return ok(await withLockRetry(() => readFile(file, "utf8")));
	} catch (e) {
		if (errnoOf(e) === "ENOENT") return ok("");
		return err({ code: "io", message: `${file}: ${String(e)}` });
	}
};

const posix = (rel: string) => rel.split(sep).join("/");

// A path in a worktree is matched relative to its own worktree (worktrees/<run>/<task>), as a path
// in the workspace is matched relative to the workspace, so rules anchored with "/" reach both.
const rootOf = (workspaceDir: string, worktreesDir: string, path: string) => {
	if (isInside(workspaceDir, path)) return workspaceDir;
	if (!isInside(worktreesDir, path)) return worktreesDir;
	const [run, task] = relative(worktreesDir, path).split(sep);
	return run && task ? join(worktreesDir, run, task) : worktreesDir;
};

/** Reads the rules once per call so edits to `.meteignore` count at once. */
export const loadIgnore = async (
	workspaceDir: string,
	worktreesDir: string,
): Promise<Result<IgnoreCheck, ToolError>> => {
	const lines = await fileLines(workspaceDir);
	if (!lines.ok) return lines;
	const rules = ignore()
		.add([...METEIGNORE_DEFAULTS])
		.add(lines.value);
	return ok((path, folder = false) => {
		const root = rootOf(workspaceDir, worktreesDir, path);
		const rel = posix(relative(root, path));
		if (rel === "" || !isInside(root, path)) return false;
		return rules.ignores(folder ? `${rel}/` : rel);
	});
};
