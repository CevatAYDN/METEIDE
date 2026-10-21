import { checkReport, repairMessage } from "../domain/guardrail.js";
import type { TaskEvent } from "../domain/task-machine.js";
import {
	addRepair,
	applyTask,
	approve,
	keepMessages,
	nextTeamStep,
	type TaskChange,
	type TeamState,
} from "../domain/team.js";
import { guardrailOf, taskConversation } from "../domain/team-run.js";
import {
	apply,
	type EngineState,
	emit,
	type Live,
	platformOf,
} from "./run-state.js";

// A team run between attempts (docs/08, Task execution sequence): start the next ready task,
// accept a submission, wait for an approver, or complete once every task is approved.

// Events name a task by its Task id, not by its template id.
const changed = (
	s: EngineState,
	l: Live,
	taskId?: string,
	change?: TaskChange,
) => {
	if (change)
		emit(s, l, { type: "task.status.changed", payload: change }, taskId);
};

// A team step that changes nothing would loop forever; that is a bug, so the run fails.
const stuck = (s: EngineState, l: Live) =>
	apply(s, l, {
		type: "FAIL",
		at: s.deps.now(),
		code: "internal",
		message: "the team made no progress",
	});

// Ends the attempt: its conversation is kept and the task moves on.
const endAttempt = (s: EngineState, l: Live, event: TaskEvent) => {
	const { team, task, messages } = l.snapshot.context;
	if (!team || !task) return stuck(s, l);
	const r = applyTask(keepMessages(team, task, messages), task, event);
	if (!r.change) return stuck(s, l);
	apply(s, l, { type: "TEAM", team: r.team });
	changed(s, l, team.tasks[task]?.id, r.change);
};

/**
 * Submits the active task with its agent's last reply as the report, once the guardrail passes;
 * a failed check asks for a repair up to max_retries times, then blocks the task (docs/08).
 * shortcut: verify gates do not run yet; no Phase 2 template uses them.
 */
export const submit = (s: EngineState, l: Live, reply: string) => {
	const { team, task } = l.snapshot.context;
	if (!team || !task) return stuck(s, l);
	const guard = guardrailOf(team, task);
	const checked = checkReport(guard?.schema, reply);
	if (checked.ok)
		return endAttempt(s, l, { type: "SUBMIT", report: checked.report });
	if (guard && (team.tasks[task]?.repairs ?? 0) < guard.max_retries) {
		const content = repairMessage(guard.schema, checked.issues);
		return apply(s, l, {
			type: "REPAIR",
			team: addRepair(team, task),
			content,
		});
	}
	return endAttempt(s, l, { type: "BLOCK", reason: "guardrail" });
};

// A task already in progress (after a block was resolved) keeps its agent and goes on.
const open = (s: EngineState, l: Live, team: TeamState, id: string) => {
	const where = platformOf(s);
	if (!where.ok) {
		const message = `${where.error.file}: ${where.error.path}: ${where.error.reason}`;
		const at = s.deps.now();
		return apply(s, l, { type: "FAIL", at, code: "bad_input", message });
	}
	const goal = l.snapshot.context.goal;
	const messages = taskConversation(team, id, goal, where.value);
	return apply(s, l, { type: "SWITCH", task: id, team, messages });
};

const start = (s: EngineState, l: Live, team: TeamState, id: string) => {
	const agentId = team.tasks[id]?.context.agentId ?? s.deps.newId();
	const r = applyTask(team, id, { type: "START", agentId });
	if (!r.change) return stuck(s, l);
	if (!open(s, l, r.team, id)) return;
	const taskId = team.tasks[id]?.id;
	emit(s, l, { type: "task.assigned", payload: { agentId } }, taskId);
	changed(s, l, taskId, r.change);
};

const accept = (s: EngineState, l: Live, team: TeamState, id: string) => {
	const r = approve(team, id, "system");
	if (!r.change) return stuck(s, l);
	apply(s, l, { type: "TEAM", team: r.team });
	changed(s, l, team.tasks[id]?.id, r.change);
};

const lastReport = (team: TeamState) => {
	const last = team.template.tasks.at(-1)?.id;
	return (last && team.tasks[last]?.context.report) || "";
};

/** Moves a team run whose active task is not in progress. */
export const teamTurn = (s: EngineState, l: Live, team: TeamState) => {
	const next = nextTeamStep(team);
	const at = s.deps.now();
	if (next.kind === "work") return open(s, l, team, next.taskId);
	if (next.kind === "start") return start(s, l, team, next.taskId);
	if (next.kind === "accept") return accept(s, l, team, next.taskId);
	if (next.kind === "complete")
		return apply(s, l, { type: "COMPLETE", at, summary: lastReport(team) });
	// shortcut: an approver role does not review yet, so its task waits like a human's; the
	// review step comes with the guardrail and approval slice.
	return apply(s, l, { type: "PAUSE", at, reason: "approval" });
};
