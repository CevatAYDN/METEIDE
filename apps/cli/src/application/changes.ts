import type { VcsGitAdapter } from "@mete/contracts";
import { CHANGES_TIMEOUT_MS } from "../defaults.js";
import type { App } from "../infrastructure/app.js";

// The Changes panel's read (ADR-100): the daemon asks vcs.git@2 for the folder's working tree, so the
// panel sees what git sees and no METE code parses porcelain. status and diff only read, so the
// policy is not asked; a folder git cannot read (no repository, no git) answers `vcs: false`.

/** How a changed file stands, in the words the panel shows. */
export type Change = "added" | "modified" | "deleted" | "renamed" | "untracked";

/** A changed file of the working tree. */
export type ChangedFile = {
	readonly path: string;
	readonly change: Change;
};

/** What `mete/changes` answers (ADR-100). */
export type Changes = {
	readonly vcs: boolean;
	readonly branch: string | null;
	readonly files: readonly ChangedFile[];
	readonly diff?: string;
};

// A porcelain letter as a word; the worktree's letter when it has one, else the index's.
const WORDS: Readonly<Record<string, Change>> = {
	A: "added",
	D: "deleted",
	R: "renamed",
};

/** One `git status --porcelain` row as a word (ADR-100); "?" is a file git does not track yet. */
export const changeOf = (index: string, worktree: string): Change => {
	if (index === "?") return "untracked";
	return WORDS[worktree !== " " ? worktree : index] ?? "modified";
};

const NONE: Changes = { vcs: false, branch: null, files: [] };

// METE's own folder is bookkeeping, not the user's work, so the list leaves it out (ADR-100).
const METE_DIR = ".mete/";
const shown = (path: string) => !path.startsWith(METE_DIR);

/** The folder's working tree, and the diff of `path` when one is asked (ADR-100). */
export const changesOf = async (app: App, path?: string): Promise<Changes> => {
	const vcs = app.registry.resolve<VcsGitAdapter>("vcs.git@2");
	if (!vcs.ok) return NONE;
	const impl = vcs.value[0].impl;
	const signal = AbortSignal.timeout(CHANGES_TIMEOUT_MS);
	const status = await impl.run({ op: "status" }, { signal });
	if (!status.ok || status.value.op !== "status") return NONE;
	const { branch, files } = status.value;
	const list = files
		.filter((f) => shown(f.path))
		.map((f) => ({ path: f.path, change: changeOf(f.index, f.worktree) }));
	if (path === undefined) return { vcs: true, branch, files: list };
	const diff = await impl.run({ op: "diff", path }, { signal });
	const text =
		diff.ok && diff.value.op === "diff" ? diff.value.diff : undefined;
	return {
		vcs: true,
		branch,
		files: list,
		...(text === undefined ? {} : { diff: text }),
	};
};
