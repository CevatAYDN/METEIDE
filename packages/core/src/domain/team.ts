import {
	type ChatMessage,
	ChatRequestSchema,
	IdSchema,
	TaskStatusSchema,
	type TeamTemplate,
	TeamTemplateSchema,
} from "@mete/contracts";
import { transition } from "xstate";
import { z } from "zod";
import { type TaskEvent, taskMachine } from "./task-machine.js";

// A team run's tasks (docs/08, Task execution sequence) as plain data inside the run snapshot,
// with the template it started from, so a resumed run does not depend on the file any more.
// shortcut: tasks run one at a time and `spawns` creates no tasks yet; parallel work and spawned
// task lists come with the slices that need them (web-dev, game-studio).

type TaskStatus = z.infer<typeof TaskStatusSchema>;

const TaskContextSchema = z.strictObject({
	revisionLimit: z.number().int().nonnegative(),
	revisions: z.number().int().nonnegative(),
	agentId: z.string().optional(),
	worktree: z.string().optional(),
	report: z.string().optional(),
	feedback: z.string().optional(),
	blocked: z
		.enum([
			"clarification",
			"capability_missing",
			"guardrail",
			"revision_limit",
		])
		.optional(),
});

const TaskEntrySchema = z.strictObject({
	/** The Task entity's id (docs/07); events name the task by it. */
	id: IdSchema,
	status: TaskStatusSchema,
	context: TaskContextSchema,
	/** The task's conversation, kept while another task works. */
	messages: z.array(ChatRequestSchema.shape.messages.element),
	/** Who approved the current submission: approver roles, "human" or "system". */
	approvals: z.array(z.string()),
	/** Guardrail repairs asked in the current attempt (docs/08, step 4). */
	repairs: z.number().int().nonnegative(),
	/** The Artifact (docs/07) of the task's expected_output, once submitted. */
	artifact: z
		.strictObject({
			id: IdSchema,
			type: z.string().min(1),
			path: z.string().min(1),
			sha256: z.string().min(1),
			createdBy: z.string().min(1),
			createdAt: z.string().min(1),
		})
		.optional(),
});

/** A team run's state as the run snapshot keeps it; checked on load like the rest. */
export const TeamStateSchema = z.strictObject({
	template: TeamTemplateSchema,
	tasks: z.record(z.string(), TaskEntrySchema),
});

/** A team run's state. */
export type TeamState = z.output<typeof TeamStateSchema>;
type TaskEntry = TeamState["tasks"][string];

/** What the team does next. */
export type TeamStep =
	| {
			readonly kind: "work" | "start" | "accept" | "merge";
			readonly taskId: string;
	  }
	| { readonly kind: "approve"; readonly taskId: string; readonly by: string }
	| { readonly kind: "wait"; readonly taskIds: readonly string[] }
	| { readonly kind: "complete" };

/** A status change of one task, for task.status.changed. */
export type TaskChange = { readonly from: TaskStatus; readonly to: TaskStatus };

/** A new team run: every task todo. */
export const teamOf = (
	template: TeamTemplate,
	newId: () => string = () => crypto.randomUUID(),
): TeamState => ({
	template,
	tasks: Object.fromEntries(
		template.tasks.map((t) => [
			t.id,
			{
				id: newId(),
				status: "todo",
				context: {
					revisionLimit: template.policies.revision_limit,
					revisions: 0,
				},
				messages: [],
				approvals: [],
				repairs: 0,
			},
		]),
	),
});

const withEntry = (team: TeamState, id: string, entry: TaskEntry) => ({
	...team,
	tasks: { ...team.tasks, [id]: entry },
});

/** Keeps a task's conversation while another task works. */
export const keepMessages = (
	team: TeamState,
	id: string,
	messages: readonly ChatMessage[],
): TeamState => {
	const entry = team.tasks[id];
	return entry
		? withEntry(team, id, { ...entry, messages: [...messages] })
		: team;
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
		? withEntry(team, id, {
				...entry,
				context: { ...entry.context, worktree: undefined },
			})
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
	const fresh = event.type === "START" || event.type === "REVISE";
	const updated: TaskEntry = {
		...entry,
		status: next.value,
		context: next.context,
		approvals: fresh ? [] : entry.approvals,
		repairs: ["START", "SUBMIT", "UNBLOCK"].includes(event.type)
			? 0
			: entry.repairs,
	};
	const out = { team: withEntry(team, id, updated) };
	return next.value === entry.status
		? out
		: { ...out, change: { from: entry.status, to: next.value } };
};

// The approver role first, then the human when the task is a human checkpoint (docs/08, step 7).
const required = (team: TeamState, id: string) => {
	const task = team.template.tasks.find((t) => t.id === id);
	const human = team.template.policies.human_checkpoints?.includes(id);
	const list = [task?.approval, human ? "human" : undefined];
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

// Task.dependsOn is the template task's `context` (docs/07, docs/08).
const ready = (team: TeamState, id: string) => {
	const s = statusOf(team, id);
	const deps = team.template.tasks.find((t) => t.id === id)?.context ?? [];
	return (
		(s === "todo" || s === "changes_requested") &&
		deps.every((d) => statusOf(team, d) === "approved")
	);
};

const review = (team: TeamState, ids: readonly string[]) => {
	for (const id of ids.filter((x) => statusOf(team, x) === "submitted")) {
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

/**
 * Applies the human's decision to a task that waits for them; undefined when it does not wait.
 * A blocked task goes back to work with the feedback as its instruction, whatever the decision.
 */
export const decide = (
	team: TeamState,
	id: string,
	{
		decision,
		feedback,
	}: { decision: "approve" | "revise"; feedback?: string | undefined },
) => {
	if (!waitingForHuman(team).includes(id)) return undefined;
	// A failed merge is tried again by approving; there is nothing to revise.
	if (unmerged(team, id)) return decision === "approve" ? { team } : undefined;
	if (statusOf(team, id) === "blocked")
		return applyTask(team, id, {
			type: "UNBLOCK",
			instruction: feedback ?? "Go on with the task.",
		});
	return decision === "approve"
		? approve(team, id, "human")
		: applyTask(team, id, { type: "REVISE", feedback: feedback ?? "" });
};

// An approved task whose worktree is still set has work to land in the workspace.
const unmerged = (team: TeamState, id: string) =>
	statusOf(team, id) === "approved" &&
	Boolean(team.tasks[id]?.context.worktree);

/** Whether an approved task still has its worktree to merge. */
export const waitsToMerge = (team: TeamState, id: string) => unmerged(team, id);

/** Decides the team's next step from its state alone, in template order; a pending merge comes first. */
export const nextTeamStep = (team: TeamState): TeamStep => {
	const ids = team.template.tasks.map((t) => t.id);
	const landing = ids.find((id) => unmerged(team, id));
	if (landing) return { kind: "merge", taskId: landing };
	const working = ids.find((id) => statusOf(team, id) === "in_progress");
	if (working) return { kind: "work", taskId: working };
	const reviewed = review(team, ids);
	if (reviewed) return reviewed;
	const start = ids.find((id) => ready(team, id));
	if (start) return { kind: "start", taskId: start };
	if (ids.every((id) => statusOf(team, id) === "approved"))
		return { kind: "complete" };
	const stuck = (s: TaskStatus | undefined) =>
		s === "blocked" || s === "submitted";
	return {
		kind: "wait",
		taskIds: ids.filter((id) => stuck(statusOf(team, id))),
	};
};
