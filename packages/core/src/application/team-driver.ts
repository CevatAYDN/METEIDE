import { artifactLine } from "@mete/contracts";
import { REVIEW_REPAIRS } from "../defaults.js";
import { attempting } from "../domain/attempts.js";
import { openTask } from "../domain/clarify.js";
import { checkReport, jsonOf, repairMessage } from "../domain/guardrail.js";
import {
	checkVerdict,
	reviewConversation,
	verdictRepair,
} from "../domain/review.js";
import { checkSpawns } from "../domain/spawn.js";
import {
	applyTask,
	approve,
	attemptState,
	isPair,
	nextTeamStep,
	setRepairs,
	type TeamState,
} from "../domain/team.js";
import { guardrailOf, titleOf } from "../domain/team-run.js";
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
} from "./run-state.js";
import { afterApproval } from "./spawned.js";
import { changed, endAttempt, land } from "./submission.js";
import { humanRequest, worktreeSetupCommand } from "./vcs-steps.js";
import { strictVerified } from "./verification-driver.js";
import { legacyVerified } from "./verify.js";
import { merge, worktreeOf } from "./worktrees.js";

// A team run between attempts (docs/08, Task execution sequence): start the next ready task,
// accept a submission, let an approver role review it, wait for the human, or complete once
// every task is approved.

// Runs the task's verify gates before the guardrail (docs/08, step 3); true when the report may go
// on. A failed gate is one more user message in the attempt, with no repair counted, so the
// attempt's turns are its only bound; a run paused or cancelled meanwhile submits again on resume.
const verified = (s: EngineState, l: Live, task: string, report: string) => {
	const team = l.snapshot.context.team;
	if (!team || l.snapshot.value !== "running") return false;
	return team.verificationVersion === 1
		? strictVerified(s, l, task, report)
		: legacyVerified(s, l, task);
};

/**
 * Submits the active task with its agent's last reply as the report, once its verify gates and the
 * guardrail pass; a failed check asks for a repair up to max_retries times, then blocks the task
 * (docs/08).
 */
export const submit = async (s: EngineState, l: Live, reply: string) => {
	const { team: before, task } = l.snapshot.context;
	if (!before || !task) return stuck(s, l);
	const token = l.token;
	if (!(await verified(s, l, task, reply))) return;
	const { team } = l.snapshot.context;
	if (
		!team ||
		l.token !== token ||
		l.snapshot.context.task !== task ||
		team.tasks[task]?.context !== before.tasks[task]?.context
	)
		return;
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
	task: {
		readonly id: string;
		readonly notes?: string | undefined;
		readonly setup?: boolean;
	},
) => {
	const where = platform(s, l);
	if (!where) return false;
	const run = { ...l.snapshot.context, notes: task.notes };
	const opened = openTask(team, task.id, run, where);
	const entry = opened.team.tasks[task.id];
	const prepared: TeamState =
		task.setup && entry
			? {
					...opened.team,
					tasks: {
						...opened.team.tasks,
						[task.id]: { ...entry, setup: "pending" },
					},
				}
			: opened.team;
	const session = team.tasks[task.id]?.session;
	return apply(s, l, {
		type: "SWITCH",
		task: task.id,
		...opened,
		team: prepared,
		state: attemptState(team, task.id),
		...(session ? { session } : {}),
	});
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

const needsSetup = (
	s: EngineState,
	team: TeamState,
	id: string,
	tree: string | undefined,
) =>
	tree &&
	tree !== team.tasks[id]?.context.worktree &&
	worktreeSetupCommand(s.deps);

const start = async (s: EngineState, l: Live, team: TeamState, id: string) => {
	const token = l.token;
	const agentId = team.tasks[id]?.context.agentId ?? s.deps.newId();
	const worktree = await worktreeOf(s, l, team, { id, agentId });
	const ctx = { runId: l.meta.id, signal: l.all.signal };
	// A kept conversation (a revision, a next attempt that opens as the work did) already holds the lessons.
	const fresh = (team.tasks[id]?.messages.length ?? 0) === 0;
	const notes = fresh
		? await readNotes(s.deps, ctx, titleOf(team, id))
		: undefined;
	// Paused or cancelled while git worked: the next start finds the worktree it made.
	if (l.token !== token || l.snapshot.value !== "running") return;
	// A best-of-N task's next attempt stays in progress (ADR-162).
	const next = team.tasks[id]?.status === "in_progress";
	const event = {
		type: next ? "ATTEMPT" : "START",
		agentId,
		...(worktree ? { worktree } : {}),
	} as const;
	const r = applyTask(team, id, event);
	if (r.team === team) return stuck(s, l);
	if (
		!open(s, l, r.team, {
			id,
			notes,
			setup: !!needsSetup(s, team, id, worktree),
		})
	)
		return;
	const taskId = team.tasks[id]?.id;
	emit(s, l, { type: "task.assigned", payload: { agentId } }, taskId);
	changed(s, l, taskId, r.change);
};

/** Starts one selected ready task; the coordinator remains the only owner of team transitions. */
export const startTask = (s: EngineState, l: Live, id: string) => {
	const team = l.snapshot.context.team;
	if (team) return start(s, l, team, id);
};

const accept = (s: EngineState, l: Live, team: TeamState, id: string) => {
	const r = approve(team, id, "system");
	if (!r.change) return stuck(s, l);
	const after = afterApproval(s, l, r.team, id);
	apply(s, l, { type: "TEAM", team: after.team });
	changed(s, l, team.tasks[id]?.id, r.change);
	after.announce();
};

// The run's summary: the last task's report, or its artifact's one line (ADR-172).
const lastReport = (team: TeamState) => {
	const last = team.template.tasks.at(-1);
	const report = (last && team.tasks[last.id]?.context.report) || "";
	const type = last?.expected_output?.replace(/^artifact:/, "");
	const json = type ? jsonOf(report) : undefined;
	return (type && json && artifactLine(type, json.value)) || report;
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
export const teamTurn = (
	s: EngineState,
	l: Live,
	team: TeamState,
	busy: readonly string[] = [],
) => {
	const next = nextTeamStep(team, busy);
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
