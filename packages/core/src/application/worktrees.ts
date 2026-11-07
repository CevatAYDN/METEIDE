import { attemptId } from "../domain/attempts.js";
import { type TeamState, withoutWorktree } from "../domain/team.js";
import { isWriter, titleOf } from "../domain/team-run.js";
import {
	apply,
	type EngineState,
	emit,
	type Live,
	stuck,
} from "./run-state.js";
import { masked } from "./steps.js";
import { setTaskWait, waitIdentity } from "./task-waits.js";
import {
	createCheckpoint,
	dropWorktree,
	landWorktree,
	startWorktree,
} from "./vcs-steps.js";

// A writing task works in a worktree of its own (docs/08, Parallel work and merging), started the
// first time and kept through revisions and blocks; each attempt of a best-of-N task has its own,
// named by the attempt's id (ADR-162).
export const worktreeOf = async (
	s: EngineState,
	l: Live,
	team: TeamState,
	target: { readonly id: string; readonly agentId: string },
) => {
	const entry = team.tasks[target.id];
	if (!entry || !isWriter(team, target.id)) return undefined;
	if (entry.context.worktree) return entry.context.worktree;
	const ids = { runId: l.meta.id, taskId: attemptId(team, target.id) };
	return startWorktree(s.deps, ids, l.all.signal);
};

// An approved task's worktree lands in the workspace before the next task starts (so that one begins
// from the merged result) and before the run completes. A merge that did not happen (a conflict, or
// the user's own edits in the way) pauses the run for the human with the branch named; the worktree
// and branch stay, and approving the task tries the merge again. The core's checkpoint before it
// records the workspace, not the worktree.
export const merge = async (
	s: EngineState,
	l: Live,
	team: TeamState,
	id: string,
) => {
	const entry = team.tasks[id];
	if (!entry) return stuck(s, l);
	const runId = l.meta.id;
	const cp = await createCheckpoint(s.deps, { runId, signal: l.all.signal });
	if (l.snapshot.value !== "running") return;
	if (!cp.ok)
		return apply(s, l, {
			type: "FAIL",
			at: s.deps.now(),
			code: "checkpoint_failed",
			message: await masked(s.deps, cp.error),
		});
	if (cp.value)
		emit(s, l, {
			type: "checkpoint.created",
			payload: { kind: "git", ref: cp.value },
		});
	// A best-of-N task merges the attempt that went on (ADR-162).
	const taskId = attemptId(team, id);
	const ids = { runId, taskId, message: titleOf(team, id) };
	const landed = await landWorktree(s.deps, ids, l.all.signal);
	if (l.snapshot.value !== "running") return;
	if (landed.kind === "landed") {
		// The record first, the cleanup after.
		apply(s, l, { type: "TEAM", team: withoutWorktree(team, id) });
		return dropWorktree(s.deps, { runId, taskId }, l.all.signal);
	}
	// Git's text may carry a remote address with a token in it: masked like a tool result (docs/07).
	const { code, paths } = landed;
	const message = await masked(s.deps, landed.message);
	const branch = `mete/${runId}/${taskId}`;
	const payload = { code, message, branch, ...(paths ? { paths } : {}) };
	emit(s, l, { type: "task.merge.failed", payload }, entry.id);
	setTaskWait(s, l, id, {
		stage: "merge",
		request: {
			...waitIdentity(l, id),
			requestId: s.deps.newId(),
			kind: "merge",
			message,
			...(paths ? { paths: [...paths] } : {}),
		},
	});
};
