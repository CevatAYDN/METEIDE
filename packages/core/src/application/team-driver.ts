import { REVIEW_REPAIRS } from "../defaults.js";
import { openTask } from "../domain/clarify.js";
import { checkReport, repairMessage } from "../domain/guardrail.js";
import {
	checkVerdict,
	reviewConversation,
	verdictRepair,
} from "../domain/review.js";
import { checkSpawns } from "../domain/spawn.js";
import type { TaskEvent } from "../domain/task-machine.js";
import {
	type ArtifactMeta,
	applyTask,
	approve,
	isPair,
	keepMessages,
	nextTeamStep,
	setRepairs,
	type TaskChange,
	type TeamState,
	withArtifact,
	withoutWorktree,
} from "../domain/team.js";
import {
	guardrailOf,
	isWriter,
	titleOf,
	verifyOf,
} from "../domain/team-run.js";
import { announce, saveArtifact } from "./artifacts.js";
import { lessonTurn } from "./lesson.js";
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
import {
	createCheckpoint,
	dropWorktree,
	humanRequest,
	landWorktree,
	runWorktreeSetup,
	startWorktree,
} from "./vcs-steps.js";
import { verifyGates } from "./verify.js";

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

// A task already in progress (after a block was resolved) keeps its agent and goes on.
const open = (s: EngineState, l: Live, team: TeamState, id: string) => {
	const where = platform(s, l);
	if (!where) return false;
	const opened = openTask(team, id, l.snapshot.context, where);
	return apply(s, l, { type: "SWITCH", task: id, ...opened });
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

// A writing task works in a worktree of its own (docs/08, Parallel work and merging), started the
// first time and kept through revisions and blocks.
const worktreeOf = async (
	s: EngineState,
	l: Live,
	team: TeamState,
	target: { readonly id: string; readonly agentId: string },
) => {
	const entry = team.tasks[target.id];
	if (!entry || !isWriter(team, target.id)) return undefined;
	if (entry.context.worktree) return entry.context.worktree;
	const ids = { runId: l.meta.id, taskId: entry.id };
	const tree = await startWorktree(s.deps, ids, l.all.signal);
	if (!tree || l.snapshot.value !== "running") return tree;
	const res = await runWorktreeSetup(
		s.deps,
		{
			worktree: tree,
			runId: l.meta.id,
			taskId: entry.id,
			agentId: target.agentId,
		},
		l.all.signal,
		(body) => emit(s, l, body, entry.id),
	);
	if (l.snapshot.value !== "running") return tree;
	if (res === "approval")
		apply(s, l, { type: "PAUSE", at: s.deps.now(), reason: "approval" });
	return tree;
};

const start = async (s: EngineState, l: Live, team: TeamState, id: string) => {
	const agentId = team.tasks[id]?.context.agentId ?? s.deps.newId();
	const worktree = await worktreeOf(s, l, team, { id, agentId });
	// Paused or cancelled while git worked: the next start finds the worktree it made.
	if (l.snapshot.value !== "running") return;
	const event = {
		type: "START",
		agentId,
		...(worktree ? { worktree } : {}),
	} as const;
	const r = applyTask(team, id, event);
	if (!r.change) return stuck(s, l);
	if (!open(s, l, r.team, id)) return;
	const taskId = team.tasks[id]?.id;
	emit(s, l, { type: "task.assigned", payload: { agentId } }, taskId);
	changed(s, l, taskId, r.change);
};

// An approved task's worktree lands in the workspace before the next task starts (so that one begins
// from the merged result) and before the run completes. A merge that did not happen (a conflict, or
// the user's own edits in the way) pauses the run for the human with the branch named; the worktree
// and branch stay, and approving the task tries the merge again. The core's checkpoint before it
// records the workspace, not the worktree.
const merge = async (s: EngineState, l: Live, team: TeamState, id: string) => {
	const entry = team.tasks[id];
	if (!entry) return stuck(s, l);
	const runId = l.meta.id;
	const cp = await createCheckpoint(s.deps, { runId, signal: l.all.signal });
	if (l.snapshot.value !== "running") return;
	if (!cp.ok)
		return apply(s, l, {
			type: "FAIL",
			at: s.deps.now(),
			code: "checkpoint_failed",
			message: cp.error,
		});
	if (cp.value)
		emit(s, l, {
			type: "checkpoint.created",
			payload: { kind: "git", ref: cp.value },
		});
	const ids = { runId, taskId: entry.id, message: titleOf(team, id) };
	const landed = await landWorktree(s.deps, ids, l.all.signal);
	if (l.snapshot.value !== "running") return;
	if (landed.kind === "landed") {
		// The record first, the cleanup after.
		apply(s, l, { type: "TEAM", team: withoutWorktree(team, id) });
		return dropWorktree(s.deps, { runId, taskId: entry.id }, l.all.signal);
	}
	const { code, message, paths } = landed;
	const branch = `mete/${runId}/${entry.id}`;
	const payload = { code, message, branch, ...(paths ? { paths } : {}) };
	emit(s, l, { type: "task.merge.failed", payload }, entry.id);
	apply(s, l, { type: "PAUSE", at: s.deps.now(), reason: "approval" });
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
	if (next.kind === "work") return open(s, l, team, next.taskId);
	if (next.kind === "start") return start(s, l, team, next.taskId);
	if (next.kind === "accept") return accept(s, l, team, next.taskId);
	if (next.kind === "merge") return merge(s, l, team, next.taskId);
	if (next.kind === "lesson") return lessonTurn(s, l, team, next.taskId);
	if (next.kind === "approve") return openReview(s, l, team, next);
	if (next.kind === "wait") return waitForHuman(s, l, team, next.taskIds);
	const summary = lastReport(team);
	return apply(s, l, { type: "COMPLETE", at: s.deps.now(), summary });
};
