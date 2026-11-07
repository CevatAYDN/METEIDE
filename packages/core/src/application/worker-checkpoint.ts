import {
	type ToolContext,
	toolEntry,
	type VcsGitAdapter,
} from "@mete/contracts";
import type { NextStep } from "../domain/next-step.js";
import type { RunContext } from "../domain/run-machine.js";
import { taskContext, taskSession } from "../domain/task-worker.js";
import { activeSeat } from "../domain/team-run.js";
import { allowed } from "../domain/tools.js";
import { verifiedCheckpointAdapter } from "./checkpoint-queue.js";
import { preparedCurrent, prepareWriter } from "./prepared-tool.js";
import { apply, type EngineState, emitAs, type Live } from "./run-state.js";
import { masked } from "./steps.js";
import { applyWorker } from "./task-worker.js";
import { createCheckpoint } from "./vcs-steps.js";

/** Captures the descriptor result only while the same worker turn still owns dispatch. */
export const inspectWorkerWriter = async (
	state: EngineState,
	live: Live,
	input: {
		task: string;
		context: RunContext;
		step: Extract<NextStep, { kind: "tool" }>;
	},
) => {
	const token = live.token;
	const cwd = input.context.team?.tasks[input.task]?.context.worktree;
	const entry = toolEntry(input.step.call.name);
	const checkpoint = verifiedCheckpointAdapter(state.deps);
	if (
		!cwd ||
		!entry ||
		!allowed(activeSeat(input.context), entry.ref) ||
		!checkpoint
	)
		return { current: true, prepared: undefined };
	const tool = await prepareWriter(
		state.deps.registry,
		input.step.call,
		cwd,
		live.all.signal,
	);
	const prepared = tool ? { ...tool, checkpoint } : undefined;
	const latest = taskContext(live.snapshot.context, input.task);
	const current =
		live.token === token &&
		live.snapshot.value === "running" &&
		latest?.messages[input.step.step] ===
			input.context.messages[input.step.step] &&
		latest?.team?.tasks[input.task]?.context ===
			input.context.team?.tasks[input.task]?.context &&
		Boolean(latest?.tainted) === Boolean(input.context.tainted);
	return {
		current,
		prepared:
			prepared && preparedCurrent(state.deps.registry, prepared)
				? prepared
				: undefined,
	};
};

/** Saves a worker's checkpoint before admission; stopped or superseded attempts never dispatch. */
export const checkpointWorker = async (
	state: EngineState,
	live: Live,
	input: {
		readonly task: string;
		readonly step: number;
		readonly ctx: ToolContext;
		readonly as: { taskId: string | undefined; agentId: string };
		readonly current: () => boolean;
		readonly checkpoint?: VcsGitAdapter | undefined;
	},
): Promise<boolean> => {
	const cp = await createCheckpoint(
		state.deps,
		{
			...input.ctx,
			runId: live.meta.id,
		},
		input.checkpoint,
	);
	if (!cp.ok) {
		const message = await masked(state.deps, cp.error);
		if (input.current())
			apply(state, live, {
				type: "FAIL",
				at: state.deps.now(),
				code: "checkpoint_failed",
				message,
			});
		return false;
	}
	if (!input.current() || !cp.value) return false;
	if (
		!applyWorker(state, live, input.task, {
			type: "CHECKPOINTED",
			step: input.step,
		})
	)
		return false;
	emitAs(
		state,
		live,
		{
			type: "checkpoint.created",
			payload: { kind: "git", ref: cp.value },
		},
		input.as,
	);
	return input.current();
};

/** A policy ask performed no write; clear its marker even when a peer already paused the run. */
export const clearWorkerFlight = (
	state: EngineState,
	live: Live,
	task: string,
) => {
	if (live.snapshot.value === "running")
		return applyWorker(state, live, task, {
			type: "TOOL_STARTED",
			callId: undefined,
		});
	const context = taskContext(live.snapshot.context, task);
	if (!context || live.snapshot.value !== "paused") return false;
	return apply(state, live, {
		type: "WORKER",
		task,
		messages: context.messages,
		session: taskSession({ ...context, inFlight: undefined }),
		requests: 0,
	});
};
