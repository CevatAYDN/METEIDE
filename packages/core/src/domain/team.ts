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
	| { readonly kind: "work" | "start" | "accept"; readonly taskId: string }
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
		repairs:
			event.type === "START" || event.type === "SUBMIT" ? 0 : entry.repairs,
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

/** Decides the team's next step from its state alone, in template order. */
export const nextTeamStep = (team: TeamState): TeamStep => {
	const ids = team.template.tasks.map((t) => t.id);
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
