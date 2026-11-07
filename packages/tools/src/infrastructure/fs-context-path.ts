import { relative, sep } from "node:path";
import { err, ok, type Result, type ToolError } from "@mete/contracts";
import { absolute, isInside, namesStream } from "../domain/paths.js";
import { contextIgnoreRules } from "./context-ignore.js";
import { walkContextPath } from "./context-link-walk.js";
import type { IgnoreCheck } from "./ignore-rules.js";

const protectedSource = (root: string, path: string) => {
	const rel = relative(root, path);
	const name = process.platform === "win32" ? rel.toLowerCase() : rel;
	const head = name.split(sep)[0];
	return head === ".mete" || head === ".git" || name === ".meteignore";
};

const boundary = (root: string, path: string): Result<void, ToolError> => {
	if (!isInside(root, path))
		return err({
			code: "outside_workspace",
			message: "Context source is outside the current workspace",
		});
	if (protectedSource(root, path))
		return err({
			code: "denied",
			rule: "protected_context_source",
			message: "Context source is protected",
		});
	return ok(undefined);
};

const checkPath =
	(root: string, rules: IgnoreCheck) =>
	(path: string, folder = false): Result<void, ToolError> => {
		const checked = boundary(root, path);
		if (!checked.ok) return checked;
		if (process.platform === "win32" && namesStream(path))
			return err({
				code: "bad_input",
				message: "Context source names a file stream",
			});
		return rules(path, folder)
			? err({
					code: "ignored",
					message: "Context source is excluded by .meteignore",
				})
			: ok(undefined);
	};

/** Checks the given path and every native resolution step inside this workspace (ADR-183). */
export const contextPath = async (
	root: string,
	path: string,
	signal: AbortSignal,
): Promise<Result<string, ToolError>> => {
	const given = absolute(root, path);
	if (process.platform === "win32" && namesStream(given))
		return err({
			code: "bad_input",
			message: "Context source names a file stream",
		});
	const lexical = boundary(root, given);
	if (!lexical.ok) return lexical;
	const rules = await contextIgnoreRules(root, signal);
	if (!rules.ok)
		return err({ code: "io", message: "Context ignore rules cannot be read" });
	const check = checkPath(root, rules.value);
	const allowed = check(given);
	return allowed.ok ? walkContextPath(path, { root, check, signal }) : allowed;
};
