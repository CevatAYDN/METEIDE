import type { RunContext } from "../domain/run-types.js";
import { currentWait } from "../domain/task-wait.js";
import { taskSession } from "../domain/task-worker.js";
import { apply, type EngineState, type Live } from "./run-state.js";

/** Keeps a review/clarification seat while releasing the coordinator for other tasks. */
export const suspendTaskContinuation = (
	state: EngineState,
	live: Live,
	context: RunContext,
) => {
	const { task, review, clarify, judge } = context;
	const team = live.snapshot.context.team;
	const entry = task ? team?.tasks[task] : undefined;
	if (!task || !team || !entry || !(review || clarify || judge)) return;
	const continuation = {
		messages: [...context.messages],
		session: taskSession(context),
		...(review ? { review } : {}),
		...(clarify ? { clarify } : {}),
		...(judge ? { judge } : {}),
	};
	apply(state, live, {
		type: "TEAM",
		team: {
			...team,
			tasks: { ...team.tasks, [task]: { ...entry, continuation } },
		},
	});
	apply(state, live, { type: "ACTIVATE", task });
};

/** Restores the same coordinator agent after its exact policy request is answered. */
export const resumeTaskContinuation = (
	state: EngineState,
	live: Live,
): boolean => {
	const team = live.snapshot.context.team;
	const found =
		team &&
		Object.entries(team.tasks).find(
			([, entry]) => entry.continuation && !currentWait(entry),
		);
	if (!team || !found) return false;
	const [task, entry] = found;
	const continuation = entry.continuation;
	if (!continuation) return false;
	apply(state, live, {
		type: "SWITCH",
		task,
		messages: continuation.messages,
		session: continuation.session,
		...(continuation.review ? { review: continuation.review } : {}),
		...(continuation.clarify ? { clarify: continuation.clarify } : {}),
		...(continuation.judge ? { judge: true } : {}),
		team: {
			...team,
			tasks: { ...team.tasks, [task]: { ...entry, continuation: undefined } },
		},
	});
	return true;
};
