import type { ToolContext } from "@mete/contracts";
import { taskContext } from "../domain/task-worker.js";
import type { TeamState } from "../domain/team.js";
import { waitForPolicy } from "./policy-wait.js";
import { apply, type EngineState, emitAs, type Live } from "./run-state.js";
import { masked } from "./steps.js";
import {
	createCheckpoint,
	runWorktreeSetup,
	type WorktreeSetupResult,
} from "./vcs-steps.js";

type Entry = TeamState["tasks"][string];

/** Whether a task still needs its exclusive setup turn; waits are filtered by the scheduler. */
export const hasPendingSetup = (entry: Entry | undefined) =>
	entry?.setup === "pending";

/** Persists setup progress against the latest team without replacing another task. */
export const setTaskSetup = (
	s: EngineState,
	l: Live,
	task: string,
	setup: NonNullable<Entry["setup"]>,
) => {
	const team = l.snapshot.context.team;
	const entry = team?.tasks[task];
	return (
		!!team &&
		!!entry &&
		apply(s, l, {
			type: "TEAM",
			team: { ...team, tasks: { ...team.tasks, [task]: { ...entry, setup } } },
		})
	);
};

const checkpointSetup = async (
	s: EngineState,
	l: Live,
	input: {
		ctx: ToolContext & { runId: string; agentId: string };
		taskId: string;
		current: () => boolean;
	},
) => {
	const cp = await createCheckpoint(s.deps, input.ctx);
	if (!cp.ok || !cp.value) {
		const message = await masked(
			s.deps,
			cp.ok ? "checkpoint unavailable" : cp.error,
		);
		if (input.current())
			apply(s, l, {
				type: "FAIL",
				at: s.deps.now(),
				code: "checkpoint_failed",
				message,
			});
		return false;
	}
	if (!input.current()) return false;
	emitAs(
		s,
		l,
		{ type: "checkpoint.created", payload: { kind: "git", ref: cp.value } },
		{ taskId: input.taskId, agentId: input.ctx.agentId },
	);
	return input.current();
};

type SetupRun = {
	readonly task: string;
	readonly entry: Entry;
	readonly agentId: string;
	readonly worktree: string;
	readonly token: object;
};

const executeSetup = async (
	s: EngineState,
	l: Live,
	run: SetupRun,
): Promise<boolean> => {
	const { task, entry, agentId, worktree, token } = run;
	const matches = () =>
		l.snapshot.context.team?.tasks[task]?.context === entry.context;
	const current = () =>
		matches() &&
		l.token === token &&
		l.snapshot.value === "running" &&
		!l.all.signal.aborted;
	const ctx = {
		runId: l.meta.id,
		agentId,
		cwd: worktree,
		signal: l.all.signal,
	};
	if (!(await checkpointSetup(s, l, { ctx, taskId: entry.id, current })))
		return false;
	if (!current() || !setTaskSetup(s, l, task, "running")) return false;
	const out = await runWorktreeSetup(
		s.deps,
		{ worktree, runId: l.meta.id, taskId: entry.id, agentId },
		ctx.signal,
		(body) => emitAs(s, l, body, { taskId: entry.id, agentId }),
	);
	return settleSetup(s, l, run, out);
};

const settleSetup = async (
	s: EngineState,
	l: Live,
	{ task, entry, token }: SetupRun,
	out: WorktreeSetupResult,
) => {
	if (
		l.snapshot.context.team?.tasks[task]?.context !== entry.context ||
		l.all.signal.aborted
	)
		return false;
	if (!setTaskSetup(s, l, task, out === "approval" ? "pending" : "done"))
		return false;
	if (out === "approval") {
		const context = taskContext(l.snapshot.context, task);
		if (
			!(context && (await waitForPolicy(s, l, context, "setup"))) &&
			l.token === token
		)
			apply(s, l, { type: "PAUSE", at: s.deps.now(), reason: "approval" });
	}
	return out === "ok";
};

/** True when model work may proceed; running/uncertain setup is never replayed automatically. */
export const runPendingSetup = async (
	s: EngineState,
	l: Live,
	task: string,
): Promise<boolean> => {
	const entry = l.snapshot.context.team?.tasks[task];
	if (!entry || l.snapshot.value !== "running" || l.all.signal.aborted)
		return false;
	if (!hasPendingSetup(entry))
		return entry.setup === undefined || entry.setup === "done";
	const { agentId, worktree } = entry.context;
	if (!agentId || !worktree) return false;
	return executeSetup(s, l, { task, entry, agentId, worktree, token: l.token });
};
