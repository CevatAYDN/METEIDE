import { lstat, readlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve, sep } from "node:path";
import { err, ok, type Result, type ToolError } from "@mete/contracts";
import { CONTEXT_LINK_HOPS } from "../defaults.js";
import { contextAttempt, contextRealpath } from "./context-source.js";

type Walk = {
	readonly root: string;
	readonly signal: AbortSignal;
	readonly check: (path: string, folder?: boolean) => Result<void, ToolError>;
};
type Cursor = {
	readonly at: string;
	readonly pending: readonly string[];
	readonly hops: number;
};

const splitParts = (path: string) =>
	path.split(process.platform === "win32" ? /[\\/]/u : sep);

const comparable = (path: string) => {
	if (process.platform !== "win32") return path.replace(/\/+$/u, "");
	// Junctions may report a namespace prefix; strip its spelling, not any path components.
	return path
		.replaceAll("/", sep)
		.replace(/^\\\\\?\\UNC\\/iu, "\\\\")
		.replace(/^\\\\\?\\/u, "")
		.replace(/\\+$/u, "")
		.toLowerCase();
};

// Keep "." and ".." until the walk reaches them: normalizing a link target can hide forbidden ancestors.
const rootedParts = (
	root: string,
	target: string,
): Result<string[], ToolError> => {
	const parts: string[] = [];
	let parent = target;
	while (comparable(parent) !== comparable(root)) {
		const next = dirname(parent);
		if (next === parent)
			return err({
				code: "outside_workspace",
				message: "Context link leaves the current workspace",
			});
		parts.unshift(basename(parent));
		parent = next;
	}
	return ok(parts);
};

const followLink = async (
	walk: Walk,
	cursor: Cursor,
	path: string,
): Promise<Result<Cursor, ToolError>> => {
	if (cursor.hops >= CONTEXT_LINK_HOPS)
		return err({
			code: "io",
			message: "Context link resolution limit exceeded",
		});
	const link = await contextAttempt(() => readlink(path), walk.signal);
	if (!link.ok) return link;
	const absolute = isAbsolute(link.value);
	const parts = absolute
		? rootedParts(walk.root, link.value)
		: ok(splitParts(link.value));
	if (!parts.ok) return parts;
	return ok({
		at: absolute ? walk.root : dirname(path),
		pending: [...parts.value, ...cursor.pending],
		hops: cursor.hops + 1,
	});
};

const advance = async (
	walk: Walk,
	cursor: Cursor,
): Promise<Result<Cursor, ToolError>> => {
	const [part, ...pending] = cursor.pending;
	const path = resolve(cursor.at, part ?? ".");
	const ancestor = pending.length > 0;
	const allowed = walk.check(path, ancestor);
	if (!allowed.ok) return allowed;
	const entry = await contextAttempt(() => lstat(path), walk.signal);
	if (!entry.ok) return entry;
	if (entry.value.isSymbolicLink())
		return followLink(walk, { ...cursor, pending }, path);
	if (ancestor && !entry.value.isDirectory())
		return err({
			code: "not_found",
			message: "Context ancestor is not a folder",
		});
	const canonical = await contextRealpath(path, walk.signal);
	if (!canonical.ok) return canonical;
	const checked = walk.check(canonical.value, entry.value.isDirectory());
	return checked.ok ? ok({ ...cursor, at: canonical.value, pending }) : checked;
};

/** Resolves links one at a time; each target and ancestor is checked before following another link. */
export const walkContextPath = async (
	path: string,
	walk: Walk,
): Promise<Result<string, ToolError>> => {
	const parts = isAbsolute(path)
		? rootedParts(walk.root, path)
		: ok(splitParts(path));
	if (!parts.ok) return parts;
	let cursor: Cursor = { at: walk.root, pending: parts.value, hops: 0 };
	while (cursor.pending.length > 0) {
		walk.signal.throwIfAborted();
		const next = await advance(walk, cursor);
		if (!next.ok) return next;
		cursor = next.value;
	}
	return ok(cursor.at);
};
