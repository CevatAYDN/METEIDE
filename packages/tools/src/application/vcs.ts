import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	err,
	ok,
	type Result,
	type ToolContext,
	type VcsError,
	type VcsGitInput,
	VcsGitInputSchema,
	type VcsGitOutput,
} from "@mete/contracts";
import { parseStatus } from "../domain/git-status.js";
import { streamCollector } from "../domain/text.js";
import { type Git, gitAt, zList } from "../infrastructure/git.js";
import { type FsDeps, parse, permit } from "./fs-common.js";
import {
	createCheckpoint,
	pruneCheckpoints,
	restoreCheckpoint,
} from "./vcs-checkpoint.js";

// vcs.git@1 in Phase 1: status, diff, commit and checkpoints (docs/10, Built-in tools).

export type VcsDeps = FsDeps & { readonly root: string };

type Out = Promise<Result<VcsGitOutput, VcsError>>;

const status = async (git: Git): Out => {
	const out = await git([
		"status",
		"--porcelain=v1",
		"-z",
		"--branch",
		"--untracked-files=all",
	]);
	return out.ok ? ok({ op: "status", ...parseStatus(out.value) }) : out;
};

const diff = async (
	git: Git,
	input: Extract<VcsGitInput, { op: "diff" }>,
): Out => {
	// A ref that starts with "-" would be read as an option.
	if (input.ref?.startsWith("-"))
		return err({ code: "bad_input", message: `not a ref: ${input.ref}` });
	const args = [
		"diff",
		...(input.staged ? ["--cached"] : []),
		...(input.ref ? [input.ref] : []),
	];
	const out = await git([...args, "--", ...(input.path ? [input.path] : [])]);
	if (!out.ok) return out;
	const cut = streamCollector();
	cut.push(out.value);
	return ok({ op: "diff", diff: cut.text() });
};

const commit = async (
	deps: VcsDeps,
	git: Git,
	input: Extract<VcsGitInput, { op: "commit" }>,
	ctx: ToolContext,
): Out => {
	const allowed = permit(
		deps,
		{ action: "git.commit", capability: "vcs.git@1", args: input },
		ctx,
	);
	if (!allowed.ok) return allowed;
	const added = await git(
		input.paths ? ["add", "--", ...input.paths] : ["add", "-A"],
	);
	if (!added.ok) return added;
	const staged = await git(["diff", "--cached", "--name-only", "-z"]);
	if (!staged.ok) return staged;
	if (zList(staged.value).length === 0)
		return err({ code: "nothing_to_commit", message: "no staged changes" });
	const done = await git(["commit", "--quiet", "-m", input.message]);
	if (!done.ok) return done;
	const sha = await git(["rev-parse", "HEAD"]);
	return sha.ok ? ok({ op: "commit", sha: sha.value.trim() }) : sha;
};

export const vcsTool = async (
	deps: VcsDeps,
	input: unknown,
	ctx: ToolContext,
): Out => {
	const i = parse(VcsGitInputSchema, input);
	if (!i.ok) return i;
	const git = gitAt(deps.root, ctx.signal);
	const v = i.value;
	switch (v.op) {
		case "status":
			return status(git);
		case "diff":
			return diff(git, v);
		case "commit":
			return commit(deps, git, v, ctx);
		case "checkpoint.create":
			return withIndex((index) => createCheckpoint(git, index, v.runId));
		case "checkpoint.restore":
			return withIndex((index) =>
				restoreCheckpoint(deps.root, git, index, v.ref),
			);
		case "checkpoint.prune":
			return pruneCheckpoints(git, v.runId);
	}
};

/** A private index file in os.tmpdir(), removed afterwards. */
const withIndex = async <T>(
	run: (index: string) => Promise<Result<T, VcsError>>,
) => {
	const dir = await mkdtemp(join(tmpdir(), "mete-index-"));
	try {
		return await run(join(dir, "index"));
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
};
