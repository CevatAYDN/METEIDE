import type URI from "@theia/core/lib/common/uri";
import type { FileService } from "@theia/filesystem/lib/browser/file-service";
import { hidden, ranked } from "../application/worktree-files.js";

// The files under a task's worktree for the card's "Show files" (ADR-132).
// shortcut: five folders deep and 200 files; a task's own work is far smaller, raise it when a team writes more.
const DEPTH = 5;
const MAX = 200;

/** The files under `dir`, as paths relative to it, pages first. */
export const worktreeFiles = async (
	files: FileService,
	dir: URI,
): Promise<string[]> => {
	const walk = async (
		folder: URI,
		prefix: string,
		depth: number,
	): Promise<string[]> => {
		const kids = ((await files.resolve(folder)).children ?? []).filter(
			(c) => !hidden(c.name),
		);
		const here = kids.filter((c) => !c.isDirectory).map((c) => prefix + c.name);
		if (depth >= DEPTH) return here;
		const below = await Promise.all(
			kids
				.filter((c) => c.isDirectory)
				.map((c) => walk(c.resource, `${prefix}${c.name}/`, depth + 1)),
		);
		return [...here, ...below.flat()];
	};
	return ranked(await walk(dir, "", 0)).slice(0, MAX);
};
