import { REVIEW_REPAIRS } from "../defaults.js";
import { checkReport, repairMessage } from "../domain/guardrail.js";
import {
	checkVerdict,
	reviewConversation,
	verdictRepair,
} from "../domain/review.js";
import type { TaskEvent } from "../domain/task-machine.js";
import {
	type ArtifactMeta,
	applyTask,
	approve,
	keepMessages,
	nextTeamStep,
	setRepairs,
	type TaskChange,
	type TeamState,
	withArtifact,
} from "../domain/team.js";
import { guardrailOf, taskConversation } from "../domain/team-run.js";
import { announce, saveArtifact } from "./artifacts.js";
import {
	apply,
	type EngineState,
	emit,
	type Live,
	platformOf,
} from "./run-state.js";

// A team run between attempts (docs/08, Task execution sequence): start the next ready task,
// accept a submission, let an approver role review it, wait for the human, or complete once
// every task is approved.

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

// Ends the attempt: its conversation (and Artifact) is kept and the task moves on.
const endAttempt = (
	s: EngineState,
	l: Live,
	event: TaskEvent,
	artifact?: ArtifactMeta,
) => {
	const { team, task, messages } = l.snapshot.context;
	if (!team || !task) return stuck(s, l);
	const kept = keepMessages(team, task, messages);
	const r = applyTask(
		artifact ? withArtifact(kept, task, artifact) : kept,
		task,
		event,
	);
	if (!r.change) return stuck(s, l);
	apply(s, l, { type: "TEAM", team: r.team });
	if (artifact) announce(s, l, team, { task, artifact });
	changed(s, l, team.tasks[task]?.id, r.change);
};

/**
 * Submits the active task with its agent's last reply as the report, once the guardrail passes;
 * a failed check asks for a repair up to max_retries times, then blocks the task (docs/08).
 * shortcut: verify gates do not run yet; no Phase 2 template uses them.
 */
export const submit = async (s: EngineState, l: Live, reply: string) => {
	const { team, task } = l.snapshot.context;
	if (!team || !task) return stuck(s, l);
	const guard = guardrailOf(team, task);
	const checked = checkReport(guard?.schema, reply);
	if (checked.ok) {
		const report = checked.report;
		const artifact = await saveArtifact(s, l, {
			report,
			json: guard !== undefined,
		});
		if (artifact === false) return; // the write failed the run
		return endAttempt(s, l, { type: "SUBMIT", report }, artifact);
	}
	if (guard && (team.tasks[task]?.repairs ?? 0) < guard.max_retries) {
		const content = repairMessage(guard.schema, checked.issues);
		return apply(s, l, {
			type: "REPAIR",
			team: setRepairs(team, task, (team.tasks[task]?.repairs ?? 0) + 1),
			content,
		});
	}
	return endAttempt(s, l, { type: "BLOCK", reason: "guardrail" });
};

// The platform a new conversation names; a broken shell setting fails the run.
const platform = (s: EngineState, l: Live) => {
	const where = platformOf(s);
	if (where.ok) return where.value;
	const message = `${where.error.file}: ${where.error.path}: ${where.error.reason}`;
	apply(s, l, { type: "FAIL", at: s.deps.now(), code: "bad_input", message });
	return undefined;
};

// A task already in progress (after a block was resolved) keeps its agent and goes on.
const open = (s: EngineState, l: Live, team: TeamState, id: string) => {
	const where = platform(s, l);
	if (!where) return false;
	const messages = taskConversation(team, id, l.snapshot.context, where);
	return apply(s, l, { type: "SWITCH", task: id, team, messages });
};

// An approver role reviews in a conversation of its own, with its own agent (docs/08, step 7).
const openReview = (
	s: EngineState,
	l: Live,
	team: TeamState,
	{ taskId: id, by }: { taskId: string; by: string },
) => {
	const where = platform(s, l);
	if (!where) return;
	const goal = l.snapshot.context.goal;
	const messages = reviewConversation(team, id, { approver: by, goal }, where);
	const fresh = setRepairs(team, id, 0);
	const switched = {
		type: "SWITCH",
		task: id,
		team: fresh,
		messages,
		review: by,
	} as const;
	if (!apply(s, l, switched)) return;
	const payload = { approver: by };
	emit(s, l, { type: "approval.requested", payload }, team.tasks[id]?.id);
};

/**
 * Applies the reviewer's verdict: approve records the approval, revise sends the task back or
 * blocks it at the revision limit. A reply that is no verdict is repaired REVIEW_REPAIRS times;
 * after that the run waits with reason approval, and resume asks the reviewer again.
 */
export const verdict = (s: EngineState, l: Live, reply: string) => {
	const { team, task, review } = l.snapshot.context;
	if (!team || !task || !review) return stuck(s, l);
	const checked = checkVerdict(reply);
	const repairs = team.tasks[task]?.repairs ?? 0;
	if (!checked.ok && repairs < REVIEW_REPAIRS) {
		const content = verdictRepair(checked.issues);
		const counted = setRepairs(team, task, repairs + 1);
		return apply(s, l, { type: "REPAIR", team: counted, content });
	}
	if (!checked.ok) {
		apply(s, l, { type: "REVIEWED", team });
		return apply(s, l, { type: "PAUSE", at: s.deps.now(), reason: "approval" });
	}
	const { decision, feedback } = checked.verdict;
	const r =
		decision === "approve"
			? approve(team, task, review)
			: applyTask(team, task, { type: "REVISE", feedback: feedback ?? "" });
	apply(s, l, { type: "REVIEWED", team: r.team });
	const taskId = team.tasks[task]?.id;
	const payload = {
		approver: review,
		decision,
		...(feedback ? { feedback } : {}),
	};
	emit(s, l, { type: "approval.resolved", payload }, taskId);
	changed(s, l, taskId, r.change);
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

// Only the human can go on: a human approval, or a blocked task.
const waitForHuman = (
	s: EngineState,
	l: Live,
	team: TeamState,
	ids: readonly string[],
) => {
	const pause = {
		type: "PAUSE",
		at: s.deps.now(),
		reason: "approval",
	} as const;
	if (!l.snapshot.can(pause)) return;
	// Before the pause, so a terminal that stops following at the pause still shows them.
	const payload = { approver: "human" };
	for (const id of ids)
		if (team.tasks[id]?.status === "submitted")
			emit(s, l, { type: "approval.requested", payload }, team.tasks[id]?.id);
	apply(s, l, pause);
};

/** Moves a team run whose active task is not in progress. */
export const teamTurn = (s: EngineState, l: Live, team: TeamState) => {
	const next = nextTeamStep(team);
	if (next.kind === "work") return open(s, l, team, next.taskId);
	if (next.kind === "start") return start(s, l, team, next.taskId);
	if (next.kind === "accept") return accept(s, l, team, next.taskId);
	if (next.kind === "approve") return openReview(s, l, team, next);
	if (next.kind === "wait") return waitForHuman(s, l, team, next.taskIds);
	const summary = lastReport(team);
	return apply(s, l, { type: "COMPLETE", at: s.deps.now(), summary });
};
