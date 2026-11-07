import {
	type EngineError,
	err,
	ok,
	type PolicyRequestsAdapter,
	type Result,
	type TaskControlAnswer,
} from "@mete/contracts";
import { openTask } from "../domain/clarify.js";
import { currentWait, withTaskWait } from "../domain/task-wait.js";
import {
	attemptState,
	decide,
	keepMessages,
	type TeamState,
} from "../domain/team.js";
import {
	apply,
	type EngineState,
	emitAs,
	type Live,
	platformOf,
} from "./run-state.js";
import { afterApproval } from "./spawned.js";

/** A stale answer cannot be retargeted to a newer request. */
export const staleTaskRequest = (): Result<never, EngineError> =>
	err({
		code: "not_found",
		message: "This task request has changed; refresh the pending tasks.",
	});

const readyTeam = (
	state: EngineState,
	live: Live,
	team: TeamState,
	id: string,
) => {
	if (team.tasks[id]?.status !== "in_progress") return ok(team);
	const where = platformOf(state);
	if (!where.ok)
		return err<EngineError>({
			code: "bad_input",
			message: "Workspace shell settings are invalid.",
		});
	const opened = openTask(team, id, live.snapshot.context, where.value);
	return ok(
		keepMessages(opened.team, id, opened.messages, attemptState(team, id)),
	);
};

const decideHuman = (
	state: EngineState,
	live: Live,
	task: string,
	answer: TaskControlAnswer,
) => {
	const team = live.snapshot.context.team;
	if (!team) return staleTaskRequest();
	const feedback = "feedback" in answer ? answer.feedback : undefined;
	const decision = answer.decision === "approve" ? "approve" : "revise";
	const changed = decide(withTaskWait(team, task, undefined), task, {
		decision,
		...(feedback ? { feedback } : {}),
	});
	if (!changed) return staleTaskRequest();
	const after = afterApproval(state, live, changed.team, task);
	const ready = readyTeam(state, live, after.team, task);
	if (!ready.ok) return ready;
	apply(state, live, { type: "TEAM", team: ready.value });
	const taskId = team.tasks[task]?.id;
	emitAs(
		state,
		live,
		{
			type: "approval.resolved",
			payload: {
				approver: "human",
				decision,
				...(feedback ? { feedback } : {}),
			},
		},
		{ taskId },
	);
	if (changed.change)
		emitAs(
			state,
			live,
			{ type: "task.status.changed", payload: changed.change },
			{ taskId },
		);
	after.announce();
	return ok(undefined);
};

const permitsDecision = (kind: string, answer: TaskControlAnswer) => {
	switch (kind) {
		case "policy":
			return answer.decision === "allow";
		case "merge":
			return answer.decision === "retry";
		case "clarification":
			return answer.decision === "answer";
		case "approval":
			return answer.decision === "approve" || answer.decision === "revise";
		case "blocked":
			return ["approve", "revise", "answer"].includes(answer.decision);
		default:
			return false;
	}
};

const saveWait = (
	state: EngineState,
	live: Live,
	task: string,
	wait: TeamState["tasks"][string]["wait"],
): Result<void, EngineError> => {
	const team = live.snapshot.context.team;
	if (!team) return staleTaskRequest();
	try {
		return apply(state, live, {
			type: "TEAM",
			team: withTaskWait(team, task, wait),
		})
			? ok(undefined)
			: staleTaskRequest();
	} catch {
		return err({
			code: "failed",
			message: "The task decision could not be saved.",
		});
	}
};

const allowTask = (
	state: EngineState,
	live: Live,
	task: string,
	answer: Extract<TaskControlAnswer, { decision: "allow" }>,
): Result<void, EngineError> => {
	const entry = live.snapshot.context.team?.tasks[task];
	const request = entry && currentWait(entry)?.request;
	const port =
		state.deps.registry.resolve<PolicyRequestsAdapter>("policy.requests@1");
	if (!request?.agentId || !port.ok) return staleTaskRequest();
	const waiting = entry?.wait;
	// No await between persistence and grant: a failed save must not consume the challenge.
	const cleared = saveWait(state, live, task, undefined);
	if (!cleared.ok) return cleared;
	const granted = port.value[0].impl.grant({
		runId: live.meta.id,
		agentId: request.agentId,
		requestId: request.requestId,
		scope: answer.scope,
	});
	if (granted.ok) return ok(undefined);
	const restored = saveWait(state, live, task, waiting);
	return restored.ok ? err(granted.error) : restored;
};

const retrySetup = (
	state: EngineState,
	live: Live,
	task: string,
	answer: TaskControlAnswer,
) => {
	if (answer.decision !== "answer" && answer.decision !== "revise")
		return err<EngineError>({
			code: "bad_input",
			message: "Verify setup effects and provide feedback before retrying.",
		});
	const team = live.snapshot.context.team;
	const entry = team?.tasks[task];
	if (!team || !entry) return staleTaskRequest();
	apply(state, live, {
		type: "TEAM",
		team: {
			...team,
			tasks: {
				...team.tasks,
				[task]: { ...entry, setup: "pending", wait: undefined },
			},
		},
	});
	return ok(undefined);
};

const applyAnswer = (
	state: EngineState,
	live: Live,
	task: string,
	answer: TaskControlAnswer,
) => {
	if (live.snapshot.context.team?.tasks[task]?.setup === "uncertain")
		return retrySetup(state, live, task, answer);
	if (answer.decision === "allow") return allowTask(state, live, task, answer);
	if (answer.decision === "retry")
		return saveWait(state, live, task, undefined);
	return decideHuman(state, live, task, answer);
};

/** Applies an answer only under the run's serialized control turn. */
export const answerTask = (
	state: EngineState,
	live: Live,
	answer: TaskControlAnswer,
): Result<void, EngineError> => {
	if (!["running", "paused"].includes(live.snapshot.value))
		return staleTaskRequest();
	const team = live.snapshot.context.team;
	const found =
		team && Object.entries(team.tasks).find(([, e]) => e.id === answer.taskId);
	if (!found) return staleTaskRequest();
	const [task, entry] = found;
	const wait = currentWait(entry);
	if (
		!wait ||
		wait.request.requestId !== answer.requestId ||
		wait.request.runId !== answer.runId
	)
		return staleTaskRequest();
	if (!permitsDecision(wait.request.kind, answer))
		return err({
			code: "bad_input",
			message: "This decision does not answer the pending task request.",
		});
	const result = applyAnswer(state, live, task, answer);
	if (!result.ok) return result;
	emitAs(
		state,
		live,
		{
			type: "task.wait.resolved",
			payload: { requestId: wait.request.requestId, kind: wait.request.kind },
		},
		{ taskId: entry.id, agentId: wait.request.agentId },
	);
	return ok(undefined);
};
