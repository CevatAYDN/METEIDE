import { isAbsolute, relative, resolve, sep } from "node:path";

// The read boundary: the workspace and the global worktrees/ folder (docs/10, Built-in tools).

/** True when `path` is `root` or inside it; compares like the platform does. */
export const isInside = (root: string, path: string) => {
	const rel = relative(root, path);
	return (
		rel === "" ||
		(!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))
	);
};

/** True when a Windows path names an NTFS stream (`file::$DATA`): a colon past the drive letter. */
export const namesStream = (abs: string) => abs.indexOf(":", 2) !== -1;

/** An input path made absolute against the workspace root. */
export const absolute = (workspaceDir: string, path: string) =>
	resolve(workspaceDir, path);

/** A path as tools report it: relative to the workspace when inside it, with "/". */
export const shown = (workspaceDir: string, path: string) =>
	isInside(workspaceDir, path)
		? relative(workspaceDir, path).split(sep).join("/") || "."
		: path.split(sep).join("/");
