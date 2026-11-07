import { IdSchema, type TaskPending } from "@mete/contracts";
import { attemptId } from "../domain/attempts.js";
import {
	currentWait,
	waitSignature,
	withTaskWait,
} from "../domain/task-wait.js";
import { waitingForHuman } from "../domain/team.js";
import { apply, type EngineState, emitAs, type Live } from "./run-state.js";

/** Display identity is derived from the task, never from client-supplied action data. */
export const waitIdentity = (live: Live, task: string) => {
	const team = live.snapshot.context.team;
	const entry = team?.tasks[task];
	if (!team || !entry) throw new Error("pending task is missing");
	const agent = IdSchema.safeParse(entry.context.agentId);
	return {
		runId: live.meta.id,
		taskId: entry.id,
		templateTaskId: task,
		title: team.template.tasks.find((t) => t.id === task)?.title ?? task,
		...(agent.success ? { agentId: agent.data } : {}),
		...(entry.context.worktree
			? {
					worktree: entry.context.worktree,
					branch: `mete/${live.meta.id}/${attemptId(team, task)}`,
				}
			: {}),
	};
};

/** Persists and announces a request once for this exact task state. */
export const setTaskWait = (
	state: EngineState,
	live: Live,
	task: string,
	input: {
		request: TaskPending;
		stage: "tool" | "verify" | "setup" | "human" | "merge";
	},
) => {
	const team = live.snapshot.context.team;
	const entry = team?.tasks[task];
	if (
		!team ||
		!entry ||
		currentWait(entry)?.request.kind === input.request.kind
	)
		return;
	apply(state, live, {
		type: "TEAM",
		team: withTaskWait(team, task, {
			...input,
			signature: waitSignature(entry),
		}),
	});
	emitAs(
		state,
		live,
		{
			type: "task.waiting",
			payload: { requestId: input.request.requestId, kind: input.request.kind },
		},
		{ taskId: entry.id, agentId: input.request.agentId },
	);
};

const humanRequest = (
	live: Live,
	task: string,
	requestId: string,
): TaskPending => {
	const entry = live.snapshot.context.team?.tasks[task];
	if (!entry) throw new Error("pending task is missing");
	const identity = { ...waitIdentity(live, task), requestId };
	if (entry.status === "submitted")
		return {
			...identity,
			kind: "approval",
			...(entry.context.report ? { report: entry.context.report } : {}),
		};
	if (entry.context.blocked === "clarification") {
		const last = entry.messages.findLast(
			(message) => message.role === "assistant",
		);
		return {
			...identity,
			kind: "clarification",
			question: last?.content || "Clarification required",
		};
	}
	return {
		...identity,
		kind: "blocked",
		reason: entry.context.blocked ?? "blocked",
	};
};

/** Discovers human approvals and blocked questions while independent work continues. */
export const syncHumanWaits = (state: EngineState, live: Live) => {
	const team = live.snapshot.context.team;
	if (!team) return;
	for (const task of waitingForHuman(team)) {
		const entry = live.snapshot.context.team?.tasks[task];
		if (!entry || currentWait(entry) || entry.status === "approved") continue;
		setTaskWait(state, live, task, {
			request: humanRequest(live, task, state.deps.newId()),
			stage: "human",
		});
	}
};
