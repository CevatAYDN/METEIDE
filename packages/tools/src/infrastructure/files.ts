import {
	lstat,
	mkdir,
	readFile,
	readlink,
	realpath,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { err, ok, type Result, type ToolError } from "@mete/contracts";
import { withLockRetry } from "@mete/kernel";
import { errnoOf } from "./errno.js";

// File access for the fs tools; Windows lock errors retry (docs/10, Built-in tools).

// As many links as Linux follows before ELOOP; a longer chain of dangling links is left as given.
const MAX_HOPS = 40;

/**
 * The real path behind `abs`; a path that does not exist yet keeps its missing tail. A link whose
 * target is missing is followed by hand, since a write through it would create that target (docs/10).
 */
export const realTarget = async (abs: string, hops = 0): Promise<string> => {
	try {
		return await realpath(abs);
	} catch (e) {
		const parent = dirname(abs);
		if (errnoOf(e) !== "ENOENT" || parent === abs) return abs;
		const link = await lstat(abs)
			.then((s) => s.isSymbolicLink())
			.catch(() => false);
		if (link && hops < MAX_HOPS)
			return realTarget(resolve(parent, await readlink(abs)), hops + 1);
		return join(await realTarget(parent, hops), basename(abs));
	}
};

const failure = (path: string, e: unknown): ToolError => {
	const code = errnoOf(e);
	const message = `${path}: ${e instanceof Error ? e.message : String(e)}`;
	if (code === "ENOENT" || code === "ENOTDIR")
		return { code: "not_found", message };
	if (code === "EISDIR") return { code: "is_directory", message };
	if (code === "EEXIST") return { code: "exists", message };
	return { code: "io", message };
};

const attempt = async <T>(path: string, run: () => Promise<T>) => {
	try {
		return ok(await withLockRetry(run));
	} catch (e) {
		return err(failure(path, e));
	}
};

/** Whether `path` is a folder, a file or missing. */
export const kindOf = async (
	path: string,
): Promise<Result<"folder" | "file", ToolError>> => {
	const s = await attempt(path, () => stat(path));
	return s.ok ? ok(s.value.isDirectory() ? "folder" : "file") : s;
};

/** A file's bytes. */
export const readBytes = (path: string) => attempt(path, () => readFile(path));

/** Writes text, creating parent folders; `createOnly` refuses an existing file. */
export const writeText = (path: string, text: string, createOnly = false) =>
	attempt(path, async () => {
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, text, { flag: createOnly ? "wx" : "w" });
	});

/** Deletes one file; a folder is refused. */
export const deleteFile = async (path: string) => {
	const kind = await kindOf(path);
	if (!kind.ok) return kind;
	if (kind.value === "folder")
		return err<ToolError>({
			code: "is_directory",
			message: `${path} is a folder`,
		});
	return attempt(path, () => rm(path));
};
