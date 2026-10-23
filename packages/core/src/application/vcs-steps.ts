import {
	err,
	ok,
	type Result,
	type ToolContext,
	type VcsGitAdapter,
} from "@mete/contracts";
import type { StepDeps } from "./steps.js";

// The checkpoint and the worktree steps of a run through vcs.git@2 (docs/08, Single agent; Teams).

/**
 * Records the working tree before a writing step; no vcs.git@2 means no checkpoint (Phase 4). The call
 * runs in the context it is given: a task in a worktree has that worktree recorded, and a caller that
 * wants the workspace recorded leaves `cwd` out.
 */
export const createCheckpoint = async (
	deps: StepDeps,
	ctx: ToolContext & { readonly runId: string },
): Promise<Result<string | undefined, string>> => {
	const chain = deps.registry.resolve<VcsGitAdapter>("vcs.git@2");
	if (!chain.ok) return ok(undefined);
	const r = await chain.value[0].impl.run(
		{ op: "checkpoint.create", runId: ctx.runId },
		ctx,
	);
	if (!r.ok) return err(r.error.message);
	return r.value.op === "checkpoint.create"
		? ok(r.value.ref)
		: err(`unexpected ${r.value.op} result`);
};

/**
 * Starts the worktree of a task through vcs.git@2 and returns its folder. Without vcs.git@2, or when
 * git cannot start one (a repository without a commit), the task works in the workspace and the
 * reason is logged.
 */
export const startWorktree = async (
	deps: StepDeps,
	ids: { readonly runId: string; readonly taskId: string },
	signal: AbortSignal,
): Promise<string | undefined> => {
	const chain = deps.registry.resolve<VcsGitAdapter>("vcs.git@2");
	if (!chain.ok) return undefined;
	const r = await chain.value[0].impl.run(
		{ op: "worktree.create", ...ids },
		{ runId: ids.runId, signal },
	);
	if (r.ok && r.value.op === "worktree.create") return r.value.path;
	const reason = r.ok ? `unexpected ${r.value.op} result` : r.error.message;
	deps.logger.warn(
		{ ...ids, reason },
		"worktree not created; the task works in the workspace",
	);
	return undefined;
};

/** How landing a task's worktree ended: merged and removed, or why the merge did not happen. */
export type Landed =
	| { readonly kind: "landed" }
	| {
			readonly kind: "failed";
			readonly code: string;
			readonly message: string;
			readonly paths?: readonly string[];
	  };

/**
 * Merges the task's branch into the workspace through vcs.git@2. A merge that did not happen leaves
 * the worktree and branch as they are; merging a branch that was merged already merges nothing, so
 * landing the same task again is safe.
 */
export const landWorktree = async (
	deps: StepDeps,
	ids: {
		readonly runId: string;
		readonly taskId: string;
		readonly message: string;
	},
	signal: AbortSignal,
): Promise<Landed> => {
	const chain = deps.registry.resolve<VcsGitAdapter>("vcs.git@2");
	if (!chain.ok)
		return {
			kind: "failed",
			code: "capability_missing",
			message: "vcs.git@2 is not active",
		};
	const merged = await chain.value[0].impl.run(
		{ op: "merge", ...ids },
		{ runId: ids.runId, signal },
	);
	if (merged.ok) return { kind: "landed" };
	const { code, message } = merged.error;
	const paths = "paths" in merged.error ? { paths: merged.error.paths } : {};
	return { kind: "failed", code, message, ...paths };
};

/**
 * Removes the worktree of a task whose merge is recorded. It comes after the record, so a failure or
 * a crash here leaves a folder behind, never a run that merges again into a deleted branch.
 */
export const dropWorktree = async (
	deps: StepDeps,
	ids: { readonly runId: string; readonly taskId: string },
	signal: AbortSignal,
): Promise<void> => {
	const chain = deps.registry.resolve<VcsGitAdapter>("vcs.git@2");
	if (!chain.ok) return;
	const gone = { op: "worktree.remove", ...ids } as const;
	const removed = await chain.value[0].impl.run(gone, {
		runId: ids.runId,
		signal,
	});
	if (!removed.ok)
		deps.logger.warn(
			{ ...ids, reason: removed.error.message },
			"worktree not removed after its merge",
		);
};
