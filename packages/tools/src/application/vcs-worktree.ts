import { access, rmdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
	err,
	ok,
	type Result,
	type ToolError,
	type VcsError,
	type VcsGitInput,
	type VcsGitOutput,
} from "@mete/contracts";
import { type Git, gitAt, zList } from "../infrastructure/git.js";
import { head, IDENTITY } from "./vcs-checkpoint.js";

// A worktree for one task of one run, and the merge of its branch (docs/08, Parallel work and
// merging). The core's own operations: no policy action, like the checkpoints.

type Out = Promise<Result<VcsGitOutput, VcsError>>;
type Where = { readonly worktreesDir: string };
type Task = { readonly runId: string; readonly taskId: string };
type Merge = Extract<VcsGitInput, { op: "merge" }>;

// The input names the run and the task only, so no path or branch comes from outside.
const place = (deps: Where, t: Task) => ({
	dir: join(deps.worktreesDir, t.runId, t.taskId),
	branch: `mete/${t.runId}/${t.taskId}`,
});

const exists = (dir: string) =>
	access(dir).then(
		() => true,
		() => false,
	);

/**
 * Starts a worktree on a new branch at HEAD; the working tree's uncommitted changes are not in it.
 * For a run and task that have one it returns that one, so a run paused between creating the
 * worktree and recording it starts again without an error.
 */
export const createWorktree = async (deps: Where, git: Git, t: Task): Out => {
	const there = place(deps, t);
	if (await exists(there.dir)) {
		const tip = await head(gitAt(there.dir));
		if (tip)
			return ok({
				op: "worktree.create",
				path: there.dir,
				branch: there.branch,
				sha: tip,
			});
	}
	const base = await head(git);
	if (!base)
		return err({
			code: "io",
			message: "the repository has no commit yet; a worktree starts from one",
		});
	const { dir, branch } = place(deps, t);
	const added = await git(["worktree", "add", "-b", branch, dir, base]);
	return added.ok
		? ok({ op: "worktree.create", path: dir, branch, sha: base })
		: added;
};

/**
 * Removes the worktree and deletes its branch when that was merged; a branch that was not merged
 * keeps its commits. Removing what is not there is not an error.
 */
export const removeWorktree = async (deps: Where, git: Git, t: Task): Out => {
	const { dir, branch } = place(deps, t);
	const there = await exists(dir);
	if (there) {
		const gone = await git(["worktree", "remove", "--force", dir]);
		if (!gone.ok) return gone;
	}
	await git(["worktree", "prune"]);
	// The run's folder goes with its last worktree; rmdir refuses one that still holds another.
	await rmdir(dirname(dir)).catch(() => undefined);
	await git(["branch", "-d", branch]);
	return ok({ op: "worktree.remove", removed: there });
};

// Everything the task left in its worktree becomes one commit on its branch.
const commitPending = async (
	dir: string,
	message: string,
	signal: AbortSignal,
): Promise<Result<undefined, ToolError>> => {
	const wt = gitAt(dir, signal);
	const dirty = await wt(["status", "--porcelain"]);
	if (!dirty.ok) return dirty;
	if (dirty.value.trim() === "") return ok(undefined);
	const added = await wt(["add", "-A"]);
	if (!added.ok) return added;
	const done = await wt(["commit", "--quiet", "-m", message], IDENTITY);
	return done.ok ? ok(undefined) : done;
};

// A merge that stopped on conflicts is undone, so the workspace is never left in the middle of one.
// git exits 1 for a conflict and writes it to stdout, which simple-git does not report as a failure,
// so the unmerged files are looked at after every merge.
const conflicted = async (git: Git): Promise<VcsError | undefined> => {
	const files = await git(["diff", "--name-only", "--diff-filter=U", "-z"]);
	const paths = files.ok ? zList(files.value) : [];
	if (paths.length === 0) return undefined;
	await git(["merge", "--abort"]);
	const message = `merging ${paths.join(", ")} conflicts with the workspace`;
	return { code: "merge_conflict", message, paths };
};

/** Commits what the task left in its worktree, then merges its branch into the workspace's. */
export const mergeWorktree = async (
	deps: Where,
	git: Git,
	input: Merge,
	signal: AbortSignal,
): Out => {
	const { dir, branch } = place(deps, input);
	if (await exists(dir)) {
		const committed = await commitPending(dir, input.message, signal);
		if (!committed.ok) return committed;
	}
	const merged = await git(
		["merge", "--no-ff", "-m", input.message, branch],
		IDENTITY,
	);
	const conflict = await conflicted(git);
	if (conflict) return err(conflict);
	if (!merged.ok) return merged;
	const sha = await git(["rev-parse", "HEAD"]);
	return sha.ok ? ok({ op: "merge", sha: sha.value.trim() }) : sha;
};
