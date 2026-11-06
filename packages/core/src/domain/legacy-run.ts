import type { RunContext, RunSnapshot } from "./run-machine.js";
import { taskSession, workerProgress } from "./task-worker.js";

/** Before scheduler snapshots, the active root seat owned progress even when START created a session. */
export const migrateLegacyRun = (
	run: RunContext,
	status: RunSnapshot["value"],
): RunContext => {
	if (run.reservations !== undefined) return run;
	// The old sequential approval branch ran nothing but left its write marker set.
	const context =
		status === "paused" && run.pause?.reason === "approval"
			? { ...run, inFlight: undefined }
			: run;
	const { task, team, agent } = context;
	if (!task || context.review || context.clarify || context.judge)
		return context;
	const entry = team?.tasks[task];
	if (
		entry?.status !== "in_progress" ||
		!entry.context.agentId ||
		(agent && entry.context.agentId !== agent.id)
	)
		return context;
	return {
		...context,
		...workerProgress(context, {
			type: "WORKER",
			task,
			messages: context.messages,
			session: taskSession(context),
			requests: 0,
		}),
	};
};
