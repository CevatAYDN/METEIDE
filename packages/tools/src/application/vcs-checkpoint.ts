import { rm } from "node:fs/promises";
import { join } from "node:path";
import {
	err,
	ok,
	type Result,
	type VcsError,
	type VcsGitOutput,
} from "@mete/contracts";
import { withLockRetry } from "@mete/kernel";
import { type Git, zList } from "../infrastructure/git.js";

// Checkpoints (SECURITY.md, Checkpoints and rollback; docs/10): commits under
// refs/mete/checkpoints/<run id>/<n> made through a private index, so no branch, no HEAD
// and not the user's index move.

const PREFIX = "refs/mete/checkpoints";
const ZERO = "0".repeat(40);
// Agents never write these, not even by restoring an older state (AGENTS.md, Never).
const PROTECTED = [
	".mete/policy.yaml",
	".mete/bindings.yaml",
	".mete/mcp.yaml",
	".meteignore",
];
// Exact bytes both ways: no line-ending conversion into the checkpoint or out of it.
const RAW = ["-c", "core.autocrlf=false"];
const IDENTITY = {
	GIT_AUTHOR_NAME: "METE",
	GIT_AUTHOR_EMAIL: "",
	GIT_COMMITTER_NAME: "METE",
	GIT_COMMITTER_EMAIL: "",
};

type Out = Promise<Result<VcsGitOutput, VcsError>>;

const refsOf = async (git: Git, runId: string) => {
	const out = await git([
		"for-each-ref",
		"--format=%(refname)",
		`${PREFIX}/${runId}/`,
	]);
	return out.ok ? ok(out.value.split("\n").filter((r) => r !== "")) : out;
};

/** HEAD's commit, or undefined before the first commit. */
const head = async (git: Git) => {
	const out = await git(["rev-parse", "--verify", "--quiet", "HEAD"]);
	return out.ok && out.value.trim() !== "" ? out.value.trim() : undefined;
};

export const createCheckpoint = async (
	git: Git,
	index: string,
	runId: string,
): Out => {
	const refs = await refsOf(git, runId);
	if (!refs.ok) return refs;
	const n =
		Math.max(0, ...refs.value.map((r) => Number(r.split("/").at(-1)))) + 1;
	const env = { GIT_INDEX_FILE: index, ...IDENTITY };
	const parent = await head(git);
	// Starting from HEAD keeps tracked files that a later .gitignore line would hide.
	const steps: string[][] = [
		...(parent ? [["read-tree", parent]] : []),
		[...RAW, "add", "-A"],
	];
	for (const args of steps) {
		const r = await git(args, env);
		if (!r.ok) return r;
	}
	const tree = await git(["write-tree"], env);
	if (!tree.ok) return tree;
	const message = `METE checkpoint ${runId}/${n}`;
	const commit = await git(
		[
			"commit-tree",
			tree.value.trim(),
			...(parent ? ["-p", parent] : []),
			"-m",
			message,
		],
		env,
	);
	if (!commit.ok) return commit;
	const ref = `${PREFIX}/${runId}/${n}`;
	const sha = commit.value.trim();
	const stored = await git(["update-ref", ref, sha, ZERO]); // ZERO: fails if the ref already exists
	return stored.ok ? ok({ op: "checkpoint.create", ref, sha }) : stored;
};

/** Files present now (tracked or untracked, not ignored) that the checkpoint lacks. */
const added = async (
	git: Git,
	ref: string,
): Promise<Result<string[], VcsError>> => {
	const then = await git(["ls-tree", "-r", "-z", "--name-only", ref]);
	if (!then.ok) return then;
	const now = await git(["ls-files", "-z", "-co", "--exclude-standard"]);
	if (!now.ok) return now;
	const kept = new Set([...zList(then.value), ...PROTECTED]);
	return ok([...new Set(zList(now.value))].filter((p) => !kept.has(p)));
};

export const restoreCheckpoint = async (
	root: string,
	git: Git,
	index: string,
	ref: string,
): Out => {
	const found = await git([
		"rev-parse",
		"--verify",
		"--quiet",
		`${ref}^{commit}`,
	]);
	if (!found.ok || found.value.trim() === "")
		return err({ code: "not_found", message: `no checkpoint ${ref}` });
	const extra = await added(git, ref);
	if (!extra.ok) return extra;
	const env = { GIT_INDEX_FILE: index };
	const steps = [
		["read-tree", ref],
		["rm", "--cached", "--quiet", "--ignore-unmatch", "--", ...PROTECTED],
		[...RAW, "checkout-index", "--all", "--force"],
	];
	for (const args of steps) {
		const r = await git(args, env);
		if (!r.ok) return r;
	}
	try {
		for (const p of extra.value)
			await withLockRetry(() => rm(join(root, p), { force: true }));
	} catch (e) {
		return err({ code: "io", message: `removing added files: ${String(e)}` });
	}
	return ok({ op: "checkpoint.restore", ref });
};

export const pruneCheckpoints = async (git: Git, runId: string): Out => {
	const refs = await refsOf(git, runId);
	if (!refs.ok) return refs;
	for (const ref of refs.value) {
		const r = await git(["update-ref", "-d", ref]);
		if (!r.ok) return r;
	}
	return ok({ op: "checkpoint.prune", removed: refs.value.length });
};
