// The files of a task's worktree that the card's "Show files" lists (ADR-132): a worktree is a
// whole checkout, so version control's and the workspace's own folders stay out.

const HIDDEN: ReadonlySet<string> = new Set([".git", "node_modules", ".mete"]);

/** A folder or file name the list skips. */
export const hidden = (name: string): boolean => HIDDEN.has(name);

export const isPage = (path: string) => /\.html?$/i.test(path);

/** Pages first, since they open rendered (ADR-129), then the rest by name; the input stays as it is. */
export const ranked = (paths: readonly string[]): string[] =>
	[...paths].sort(
		(a, b) => Number(isPage(b)) - Number(isPage(a)) || a.localeCompare(b),
	);
