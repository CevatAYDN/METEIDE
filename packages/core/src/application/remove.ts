import {
	type EngineError,
	err,
	ok,
	type Result,
	type VcsGitAdapter,
	type VcsGitInput,
} from "@mete/contracts";
import { attemptIds } from "../domain/attempts.js";
import { type EngineState, iso, peek } from "./run-state.js";

// team.engine@2 `remove` (ADR-143): an ended run goes with what it left. Git goes first and the
// rows last, so a refusal leaves a run the user can remove again rather than folders no run names.
// The run's events and model calls belong to storage and the gateway, which delete their rows on
// run.removed; the audit log stays (SECURITY.md).

type Out = Promise<Result<void, EngineError>>;

const ENDED = new Set(["completed", "failed", "cancelled"]);
// Only bounds a git call that hangs; removing a worktree with node_modules takes seconds.
const GIT_TIMEOUT_MS = 120_000;

// Every task of a team run, not only those with a recorded worktree: a crash between creating one
// and recording it leaves a folder, and removing what is not there is not an error.
const removals = (s: EngineState, runId: string): VcsGitInput[] => {
	const snapshot = peek(s, runId);
	const tasks = snapshot.ok ? snapshot.value.context.team?.tasks : undefined;
	// A worktree is named by the task's id, not by its key, the template's task id, or by the id of
	// a best-of-N task's attempt (ADR-162).
	return [
		...Object.values(tasks ?? {}).flatMap((t) =>
			attemptIds(t).map((taskId) => ({
				op: "worktree.remove" as const,
				runId,
				taskId,
				force: true,
			})),
		),
		{ op: "checkpoint.prune", runId },
	];
};

const clearGit = async (s: EngineState, runId: string): Out => {
	const vcs = s.deps.registry.resolve<VcsGitAdapter>("vcs.git@2");
	if (!vcs.ok) return ok(undefined);
	for (const input of removals(s, runId)) {
		const r = await vcs.value[0].impl.run(input, {
			runId,
			signal: AbortSignal.timeout(GIT_TIMEOUT_MS),
		});
		if (!r.ok) return err({ code: "failed", message: r.error.message });
	}
	return ok(undefined);
};

/** Deletes an ended run with its worktrees, branches, checkpoints and rows, then publishes run.removed. */
export const removeRun = async (s: EngineState, runId: string): Out => {
	const [run] = s.deps.store.list(runId);
	if (!run) return err({ code: "not_found", message: `no run ${runId}` });
	if (!ENDED.has(run.status))
		return err({
			code: "invalid_state",
			message: `run ${runId} is ${run.status}; stop it before removing it`,
			status: run.status,
		});
	// A cancelled run's loop may still be finishing; it would write the row again.
	await s.live.get(runId)?.loop;
	const git = await clearGit(s, runId);
	if (!git.ok) return git;
	try {
		await s.deps.snapshots?.prune(runId);
	} catch (e) {
		return err({ code: "failed", message: String(e) });
	}
	s.deps.store.remove(runId);
	s.live.delete(runId);
	s.deps.events.publish({
		id: s.deps.newId(),
		ts: iso(s.deps.now()),
		schema: 1,
		workspaceId: s.deps.workspaceId,
		runId,
		source: "core-engine",
		type: "run.removed",
		payload: {},
	});
	return ok(undefined);
};
