import { transition } from "xstate";
import { reservedFor } from "../domain/request-reservations.js";
import { type RunEvent, runMachine } from "../domain/run-machine.js";
import { taskContext, taskSession } from "../domain/task-worker.js";
import { isAsking } from "../domain/team-run.js";
import { apply, type EngineState, type Live } from "./run-state.js";

type WorkerEvent = Extract<
	RunEvent,
	{
		type:
			| "MODEL"
			| "REPLIED"
			| "TOOL_STARTED"
			| "TOOL_DONE"
			| "CHECKPOINTED"
			| "SUMMARIZED"
			| "CUT";
	}
> & { readonly reservation?: string | undefined };

/** Persists one worker's step against the latest run snapshot, preserving all other workers. */
export const applyWorker = (
	state: EngineState,
	live: Live,
	task: string,
	event: WorkerEvent,
): boolean => {
	const value = live.snapshot.value;
	if (
		event.reservation &&
		!reservedFor(live.snapshot.context, event.reservation, task)
	)
		return false;
	const settling = event.type === "TOOL_DONE" || event.type === "CHECKPOINTED";
	if (value !== "running" && !(value === "paused" && settling)) return false;
	if (live.snapshot.context.team?.tasks[task]?.status !== "in_progress")
		return false;
	const context = taskContext(live.snapshot.context, task);
	if (!context) return false;
	const worker = runMachine.resolveState({ value, context });
	const [next] = transition(runMachine, worker, event);
	return apply(state, live, {
		type: "WORKER",
		task,
		messages: next.context.messages,
		session: taskSession(next.context),
		requests: next.context.requests - context.requests,
		reservation: event.reservation,
	});
};

/** Saves the real sequential seat after a tool, repair or task opening; never a coordinator's conversation. */
export const keepWorker = (state: EngineState, live: Live) => {
	const context = live.snapshot.context;
	const task = context.task;
	if (
		!task ||
		context.review ||
		context.clarify ||
		context.judge ||
		isAsking(context)
	)
		return;
	const entry = context.team?.tasks[task];
	if (entry?.status !== "in_progress" || !entry.context.agentId) return;
	if (context.agent && context.agent.id !== entry.context.agentId) return;
	return apply(state, live, {
		type: "WORKER",
		task,
		messages: context.messages,
		session: taskSession(context),
		requests: 0,
	});
};
