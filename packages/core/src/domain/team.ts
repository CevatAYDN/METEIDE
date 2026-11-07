import type { ChatMessage, TeamTemplate } from "@mete/contracts";
import { transition } from "xstate";
import {
	dequeueMerge,
	enqueueMerge,
	pendingMerges,
	unmergedTask,
} from "./merge-queue.js";
import { type TaskEvent, taskMachine } from "./task-machine.js";
import { readyTasks } from "./task-readiness.js";
import { freshTaskSession } from "./task-session-schema.js";
import { currentWait } from "./task-wait.js";
import type { TeamState } from "./team-schema.js";

export { readyTasks } from "./task-readiness.js";
export { type TeamState, TeamStateSchema } from "./team-schema.js";

// A team run's tasks (docs/08, Task execution sequence) as plain data inside the run snapshot,
// with the template it started from, so a resumed run does not depend on the file any more.
// Tasks a `spawns` task adds join the template copy (domain/spawn.ts, ADR-057).

type TaskEntry = TeamState["tasks"][string];
type TaskStatus = TaskEntry["status"];

/** What the team does next. */
export type TeamStep =
	| {
			readonly kind: "work" | "start" | "accept" | "merge" | "lesson";
			readonly taskId: string;
	  }
	| { readonly kind: "approve"; readonly taskId: string; readonly by: string }
	| { readonly kind: "wait"; readonly taskIds: readonly string[] }
	| { readonly kind: "complete" };

/** A status change of one task, for task.status.changed. */
export type TaskChange = { readonly from: TaskStatus; readonly to: TaskStatus };

/** A task entry before its first start, under the template's revision limit. */
export const todoEntry = (template: TeamTemplate, id: string): TaskEntry => ({
	id,
	status: "todo",
	context: { revisionLimit: template.policies.revision_limit, revisions: 0 },
	messages: [],
	approvals: [],
	repairs: 0,
});

/** A new team run: every task todo. */
export const teamOf = (
	template: TeamTemplate,
	newId: () => string = () => crypto.randomUUID(),
): TeamState => ({
	template,
	tasks: Object.fromEntries(
		template.tasks.map((t) => [t.id, todoEntry(template, newId())]),
	),
});

const withEntry = (
	team: TeamState,
	id: string,
	entry: TaskEntry,
): TeamState => {
	const next = { ...team, tasks: { ...team.tasks, [id]: entry } };
	return entry.status === "approved" && team.tasks[id]?.status !== "approved"
		? enqueueMerge(next, id)
		: next;
};

/** What a task's attempt carries between the conversations the run holds (SECURITY.md, taint). */
export type AttemptState = {
	readonly turns: number;
	readonly tainted: boolean;
};

/** Keeps a task's conversation while another task works; `state` keeps the attempt's taint and turns with it. */
export const keepMessages = (
	team: TeamState,
	id: string,
	messages: readonly ChatMessage[],
	state?: AttemptState,
): TeamState => {
	const entry = team.tasks[id];
	if (!entry) return team;
	const session = state
		? { ...(entry.session ?? freshTaskSession()), ...state }
		: entry.session;
	return withEntry(team, id, {
		...entry,
		messages: [...messages],
		...(session ? { session } : {}),
	});
};

/** The taint and turns a task's kept conversation goes on with; fresh when none were kept. */
export const attemptState = (team: TeamState, id: string): AttemptState => {
	const session = team.tasks[id]?.session;
	return { turns: session?.turns ?? 0, tainted: session?.tainted ?? false };
};

/** A task's Artifact. */
export type ArtifactMeta = NonNullable<TaskEntry["artifact"]>;

/** Records a task's Artifact. */
export const withArtifact = (
	team: TeamState,
	id: string,
	artifact: ArtifactMeta,
): TeamState => {
	const entry = team.tasks[id];
	return entry ? withEntry(team, id, { ...entry, artifact }) : team;
};

/** Forgets a task's worktree once it is merged: an approved task is final, so no machine event does it. */
export const withoutWorktree = (team: TeamState, id: string): TeamState => {
	const entry = team.tasks[id];
	return entry
		? dequeueMerge(
				withEntry(team, id, {
					...entry,
					context: { ...entry.context, worktree: undefined },
				}),
				id,
			)
		: team;
};

/** What a task hears when it goes on as it is: the human lifted its block without words (docs/08), or it had no questions (ADR-142). */
export const GO_ON = "Go on with the task.";

/** Moves a task's questions before the work on (ADR-142); undefined once they are answered. */
export const withClarify = (
	team: TeamState,
	id: string,
	clarify: "asking" | "asked" | undefined,
): TeamState => {
	const entry = team.tasks[id];
	return entry
		? withEntry(team, id, { ...entry, context: { ...entry.context, clarify } })
		: team;
};

/** Sets how many repairs a task's current attempt or review has asked. */
export const setRepairs = (
	team: TeamState,
	id: string,
	repairs: number,
): TeamState => {
	const entry = team.tasks[id];
	return entry ? withEntry(team, id, { ...entry, repairs }) : team;
};

/** Applies a task-machine event; an event the task's state ignores changes nothing. */
export const applyTask = (
	team: TeamState,
	id: string,
	event: TaskEvent,
): { team: TeamState; change?: TaskChange } => {
	const entry = team.tasks[id];
	if (!entry) return { team };
	const prev = taskMachine.resolveState({
		value: entry.status,
		context: entry.context,
	});
	if (!prev.can(event)) return { team };
	const [next] = transition(taskMachine, prev, event);
	const fresh = ["START", "REVISE", "PAIR_REVISE"].includes(event.type);
	const reopened = [
		"START",
		"ATTEMPT",
		"REVISE",
		"PAIR_REVISE",
		"UNBLOCK",
	].includes(event.type);
	// A block lifted goes on in the same attempt: its taint stays (SECURITY.md), its turns start over.
	const session =
		event.type === "UNBLOCK"
			? { ...freshTaskSession(), tainted: entry.session?.tainted === true }
			: reopened
				? freshTaskSession()
				: entry.session;
	const updated: TaskEntry = {
		...entry,
		status: next.value,
		context: next.context,
		session,
		approvals: fresh ? [] : entry.approvals,
		repairs: ["START", "ATTEMPT", "SUBMIT", "UNBLOCK"].includes(event.type)
			? 0
			: entry.repairs,
	};
	const out = { team: withEntry(team, id, updated) };
	return next.value === entry.status
		? out
		: { ...out, change: { from: entry.status, to: next.value } };
};

/** Whether `by` is the task's pair reviewer (ADR-136). */
export const isPair = (team: TeamState, id: string, by: string) =>
	team.template.tasks.find((t) => t.id === id)?.review?.pair_with === by;

// The pair while it has turns (docs/08, step 5; ADR-136), the approver role, then the human when
// the task is a human checkpoint (step 7).
const required = (team: TeamState, id: string) => {
	const task = team.template.tasks.find((t) => t.id === id);
	const turns = team.tasks[id]?.context.pairTurns ?? 0;
	const pair =
		task?.review && turns < task.review.max_turns
			? task.review.pair_with
			: undefined;
	const human = team.template.policies.human_checkpoints?.includes(id);
	const list = [pair, task?.approval, human ? "human" : undefined];
	return [...new Set(list.filter((a) => a !== undefined))];
};

const missing = (team: TeamState, id: string) =>
	required(team, id).filter((a) => !team.tasks[id]?.approvals.includes(a));

/** Records one approval of a submitted task; the last one needed approves it. */
export const approve = (team: TeamState, id: string, by: string) => {
	const entry = team.tasks[id];
	if (entry?.status !== "submitted") return { team };
	const approvals = [...new Set([...entry.approvals, by])];
	const after = withEntry(team, id, { ...entry, approvals });
	if (missing(after, id).length > 0) return { team: after };
	return applyTask(after, id, { type: "APPROVE" });
};

const statusOf = (team: TeamState, id: string) => team.tasks[id]?.status;

const review = (team: TeamState, ids: readonly string[]) => {
	for (const id of ids.filter(
		(x) => statusOf(team, x) === "submitted" && !currentWait(team.tasks[x]),
	)) {
		const next = missing(team, id)[0];
		if (next === undefined) return { kind: "accept", taskId: id } as const;
		if (next !== "human")
			return { kind: "approve", taskId: id, by: next } as const;
	}
	return undefined;
};

/**
 * The tasks only the human can move on: a submission whose next approval is the human's, a blocked
 * task, or an approved task whose merge failed and waits (approve tries it again).
 */
export const waitingForHuman = (team: TeamState) =>
	team.template.tasks
		.map((t) => t.id)
		.filter((id) => {
			const s = statusOf(team, id);
			return (
				s === "blocked" ||
				unmerged(team, id) ||
				(s === "submitted" && missing(team, id)[0] === "human")
			);
		});

/** The human's answer to a task that waits for them. */
type Decision = {
	readonly decision: "approve" | "revise";
	readonly feedback?: string | undefined;
};

// A blocked task goes back to work with the feedback as its instruction, whatever the decision,
// except that approve accepts the submission a revision-limit block kept, the human's approval
// standing for the approvers it still waited for (ADR-157).
const unblock = (team: TeamState, id: string, entry: TaskEntry, d: Decision) =>
	d.decision === "approve" && entry.context.blocked === "revision_limit"
		? applyTask(withEntry(team, id, { ...entry, approvals: ["human"] }), id, {
				type: "APPROVE",
			})
		: applyTask(team, id, {
				type: "UNBLOCK",
				instruction: d.feedback ?? GO_ON,
			});

/** Applies the human's decision to a task that waits for them; undefined when it does not wait. */
export const decide = (team: TeamState, id: string, d: Decision) => {
	const { decision, feedback } = d;
	if (!waitingForHuman(team).includes(id)) return undefined;
	// A failed merge is tried again by approving; there is nothing to revise.
	if (unmerged(team, id)) return decision === "approve" ? { team } : undefined;
	const entry = team.tasks[id];
	if (entry?.status === "blocked") return unblock(team, id, entry, d);
	return decision === "approve"
		? approve(team, id, "human")
		: applyTask(team, id, { type: "REVISE", feedback: feedback ?? "" });
};

// An approved task whose worktree is still set has work to land in the workspace.
const unmerged = unmergedTask;

/** Whether an approved task still has its worktree to merge. */
export const waitsToMerge = (team: TeamState, id: string) => unmerged(team, id);

// An approved, merged task whose template asks for a lesson and has none yet (docs/08, step 8).
const owesLesson = (team: TeamState, id: string) =>
	statusOf(team, id) === "approved" &&
	!unmerged(team, id) &&
	team.tasks[id]?.lesson === undefined &&
	team.template.tasks.find((t) => t.id === id)?.memory?.write_lessons === true;

/** Records how a task's lesson ended, so it is asked once. */
export const withLesson = (
	team: TeamState,
	id: string,
	lesson: "written" | "skipped",
): TeamState => {
	const entry = team.tasks[id];
	return entry ? withEntry(team, id, { ...entry, lesson }) : team;
};

/**
 * Pending merges follow final-approval order; other task choices retain template order.
 * Merges and lessons finish before the next dependency starts or the run completes.
 */
const allLanded = (team: TeamState, ids: readonly string[]) =>
	pendingMerges(team).length === 0 &&
	ids.every((id) => statusOf(team, id) === "approved");

export const nextTeamStep = (
	team: TeamState,
	busy: readonly string[] = [],
): TeamStep => {
	const ids = team.template.tasks.map((t) => t.id);
	const landing = pendingMerges(team)[0];
	if (landing && !currentWait(team.tasks[landing]))
		return { kind: "merge", taskId: landing };
	const learning = ids.find((id) => owesLesson(team, id));
	if (learning) return { kind: "lesson", taskId: learning };
	const working = ids.find(
		(id) =>
			statusOf(team, id) === "in_progress" &&
			!busy.includes(id) &&
			!currentWait(team.tasks[id]),
	);
	// A best-of-N task's next attempt has no agent yet (ADR-162): it starts like a task.
	const fresh = !team.tasks[working ?? ""]?.context.agentId;
	if (working) return { kind: fresh ? "start" : "work", taskId: working };
	const reviewed = review(team, ids);
	if (reviewed) return reviewed;
	const start = readyTasks(team)[0];
	if (start) return { kind: "start", taskId: start };
	if (allLanded(team, ids)) return { kind: "complete" };
	const stuck = (s: TaskStatus | undefined) =>
		s === "blocked" || s === "submitted";
	return {
		kind: "wait",
		taskIds: ids.filter(
			(id) => stuck(statusOf(team, id)) || currentWait(team.tasks[id]),
		),
	};
};
