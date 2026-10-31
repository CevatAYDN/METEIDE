import { REVIEW_REPAIRS } from "../defaults.js";
import { attempting, withOpening } from "../domain/attempts.js";
import { openTask } from "../domain/clarify.js";
import { checkReport, repairMessage } from "../domain/guardrail.js";
import {
	checkVerdict,
	reviewConversation,
	verdictRepair,
} from "../domain/review.js";
import { checkSpawns } from "../domain/spawn.js";
import {
	applyTask,
	approve,
	isPair,
	nextTeamStep,
	setRepairs,
	type TeamState,
} from "../domain/team.js";
import { guardrailOf, titleOf, verifyOf } from "../domain/team-run.js";
import { afterAttempt, settle } from "./attempts.js";
import { openJudge } from "./judge.js";
import { lessonTurn } from "./lesson.js";
import { readNotes } from "./notes.js";
import {
	apply,
	type EngineState,
	emit,
	type Live,
	platform,
	stuck,
	toolContext,
} from "./run-state.js";
import { afterApproval } from "./spawned.js";
import { changed, endAttempt, land } from "./submission.js";
import { humanRequest } from "./vcs-steps.js";
import { verifyGates } from "./verify.js";
import { merge, worktreeOf } from "./worktrees.js";

// A team run between attempts (docs/08, Task execution sequence): start the next ready task,
// accept a submission, let an approver role review it, wait for the human, or complete once
// every task is approved.

// Runs the task's verify gates before the guardrail (docs/08, step 3); true when the report may go
// on. A failed gate is one more user message in the attempt, with no repair counted, so the
// attempt's turns are its only bound; a run paused or cancelled meanwhile submits again on resume.
const verified = async (
	s: EngineState,
	l: Live,
	team: TeamState,
	task: string,
) => {
	const gates = verifyOf(team, task);
	if (gates.length === 0) return true;
	const taskId = team.tasks[task]?.id;
	const gated = await verifyGates(s.deps, {
		gates,
		ctx: toolContext(l),
		emit: (body) => emit(s, l, body, taskId),
		skipped: (capability) =>
			s.deps.logger.warn(
				{ runId: l.meta.id, taskId, capability },
				"verify gate skipped: no adapter provides its capability",
			),
	});
	if (l.snapshot.value !== "running") return false;
	if (gated.kind === "passed") return true;
	if (gated.kind === "failed")
		apply(s, l, { type: "REPAIR", team, content: gated.content });
	else if (gated.kind === "approval")
		apply(s, l, { type: "PAUSE", at: s.deps.now(), reason: "approval" });
	else endAttempt(s, l, { type: "BLOCK", reason: "capability_missing" });
	return false;
};

/**
 * Submits the active task with its agent's last reply as the report, once its verify gates and the
 * guardrail pass; a failed check asks for a repair up to max_retries times, then blocks the task
 * (docs/08).
 */
export const submit = async (s: EngineState, l: Live, reply: string) => {
	const { team, task } = l.snapshot.context;
	if (!team || !task) return stuck(s, l);
	if (!(await verified(s, l, team, task))) return;
	const guard = guardrailOf(team, task);
	const checked = checkSpawns(team, task, checkReport(guard?.schema, reply));
	if (checked.ok) return passed(s, l, checked.report);
	if (guard && (team.tasks[task]?.repairs ?? 0) < guard.max_retries) {
		const content = repairMessage(guard.schema, checked.issues);
		return apply(s, l, {
			type: "REPAIR",
			team: setRepairs(team, task, (team.tasks[task]?.repairs ?? 0) + 1),
			content,
		});
	}
	return spent(s, l);
};

const bestOfN = (l: Live) => {
	const { team, task } = l.snapshot.context;
	return team !== undefined && task !== undefined && attempting(team, task);
};

// The report passed its checks: a best-of-N task's attempt is over (ADR-162), any other task submits.
const passed = (s: EngineState, l: Live, report: string) =>
	bestOfN(l) ? attempted(s, l, report) : land(s, l, { report });

// The repairs ran out: a best-of-N task's attempt is spent (ADR-162), any other task is blocked.
const spent = (s: EngineState, l: Live) =>
	bestOfN(l)
		? attempted(s, l)
		: endAttempt(s, l, { type: "BLOCK", reason: "guardrail" });

// A best-of-N task's attempt is checked (ADR-162): the next one starts, a judge chooses among the
// candidates, or the one that goes on is submitted, or the last is blocked with its problems.
const attempted = async (s: EngineState, l: Live, report?: string) => {
	const then = afterAttempt(s, l, report);
	if (then.kind === "next") return;
	if (then.kind === "judging") return openJudge(s, l);
	await settle(s, l, then);
};

// A task already in progress (after a block was resolved) keeps its agent and goes on; a starting
// one, or a best-of-N task's next attempt, opens with the lessons its title finds (ADR-151).
const open = (
	s: EngineState,
	l: Live,
	team: TeamState,
	task: { readonly id: string; readonly notes?: string | undefined },
) => {
	const where = platform(s, l);
	if (!where) return false;
	const run = { ...l.snapshot.context, notes: task.notes };
	const opened = openTask(team, task.id, run, where);
	// The human's answers end the questions; every later attempt opens with them (ADR-162).
	const ended =
		team.tasks[task.id]?.context.clarify === "asked" &&
		!opened.team.tasks[task.id]?.context.clarify;
	const next = ended
		? withOpening(opened.team, task.id, opened.messages)
		: opened.team;
	const { messages } = opened;
	return apply(s, l, { type: "SWITCH", task: task.id, team: next, messages });
};

// A pair reviewer or an approver role reviews in a conversation of its own, with its own agent
// (docs/08, steps 5 and 7; ADR-136).
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
	const body = isPair(team, id, by)
		? ({ type: "review.requested", payload: { reviewerRoleId: by } } as const)
		: ({ type: "approval.requested", payload: { approver: by } } as const);
	emit(s, l, body, team.tasks[id]?.id);
};

// A pair reviewer's verdict is a review, an approver's an approval (ADR-136).
const resolved = (
	pair: boolean,
	by: string,
	decision: "approve" | "revise",
	feedback: string | undefined,
) => {
	const said = feedback ? { feedback } : {};
	return pair
		? ({
				type: "review.completed",
				payload: { reviewerRoleId: by, decision, ...said },
			} as const)
		: ({
				type: "approval.resolved",
				payload: { approver: by, decision, ...said },
			} as const);
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
	const pair = isPair(team, task, review);
	const back = pair ? "PAIR_REVISE" : "REVISE";
	const r =
		decision === "approve"
			? approve(team, task, review)
			: applyTask(team, task, { type: back, feedback: feedback ?? "" });
	const after = afterApproval(s, l, r.team, task);
	apply(s, l, { type: "REVIEWED", team: after.team });
	const taskId = team.tasks[task]?.id;
	emit(s, l, resolved(pair, review, decision, feedback), taskId);
	changed(s, l, taskId, r.change);
	after.announce();
};

const start = async (s: EngineState, l: Live, team: TeamState, id: string) => {
	const agentId = team.tasks[id]?.context.agentId ?? s.deps.newId();
	const worktree = await worktreeOf(s, l, team, { id, agentId });
	const ctx = { runId: l.meta.id, signal: l.all.signal };
	const notes = await readNotes(s.deps, ctx, titleOf(team, id));
	// Paused or cancelled while git worked: the next start finds the worktree it made.
	if (l.snapshot.value !== "running") return;
	// A best-of-N task's next attempt stays in progress (ADR-162).
	const next = team.tasks[id]?.status === "in_progress";
	const event = {
		type: next ? "ATTEMPT" : "START",
		agentId,
		...(worktree ? { worktree } : {}),
	} as const;
	const r = applyTask(team, id, event);
	if (r.team === team) return stuck(s, l);
	if (!open(s, l, r.team, { id, notes })) return;
	const taskId = team.tasks[id]?.id;
	emit(s, l, { type: "task.assigned", payload: { agentId } }, taskId);
	changed(s, l, taskId, r.change);
};

const accept = (s: EngineState, l: Live, team: TeamState, id: string) => {
	const r = approve(team, id, "system");
	if (!r.change) return stuck(s, l);
	const after = afterApproval(s, l, r.team, id);
	apply(s, l, { type: "TEAM", team: after.team });
	changed(s, l, team.tasks[id]?.id, r.change);
	after.announce();
};

const lastReport = (team: TeamState) => {
	const last = team.template.tasks.at(-1)?.id;
	return (last && team.tasks[last]?.context.report) || "";
};

// Only the human can go on: a human approval, or a blocked task.
const waitForHuman = async (
	s: EngineState,
	l: Live,
	team: TeamState,
	ids: readonly string[],
) => {
	const pause = () =>
		({ type: "PAUSE", at: s.deps.now(), reason: "approval" }) as const;
	if (!l.snapshot.can(pause())) return;
	const tasks = ids.flatMap((id) => team.tasks[id] ?? []);
	const waiting = tasks.filter((t) => t.status === "submitted");
	const asks = await Promise.all(
		waiting.map(async (t) => ({
			id: t.id,
			payload: await humanRequest(
				s.deps,
				{ runId: l.meta.id, worktree: t.context.worktree },
				l.all.signal,
			),
		})),
	);
	// Paused or cancelled while git worked: the next turn asks again.
	if (l.snapshot.value !== "running" || !l.snapshot.can(pause())) return;
	// Before the pause, so a terminal that stops following at the pause still shows them.
	for (const { id, payload } of asks)
		emit(s, l, { type: "approval.requested", payload }, id);
	apply(s, l, pause());
};

/** Moves a team run whose active task is not in progress. */
export const teamTurn = (s: EngineState, l: Live, team: TeamState) => {
	const next = nextTeamStep(team);
	if (next.kind === "work") return open(s, l, team, { id: next.taskId });
	if (next.kind === "start") return start(s, l, team, next.taskId);
	if (next.kind === "accept") return accept(s, l, team, next.taskId);
	if (next.kind === "merge") return merge(s, l, team, next.taskId);
	if (next.kind === "lesson") return lessonTurn(s, l, team, next.taskId);
	if (next.kind === "approve") return openReview(s, l, team, next);
	if (next.kind === "wait") return waitForHuman(s, l, team, next.taskIds);
	const summary = lastReport(team);
	return apply(s, l, { type: "COMPLETE", at: s.deps.now(), summary });
};
