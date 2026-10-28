import type { MeteEvent } from "@mete/contracts";
import { type AgentCard, agentsAfter } from "./agents.js";
import { type CheckpointCard, checkpointsAfter } from "./checkpoints.js";
import { NO_SIGNALS, type RunSignals, signalsAfter } from "./signals.js";

// The view model the Team panel's views share (ADR-051, docs/13): a pure fold over one run's
// events. The panel feeds it the run's history (mete/events) and then the live stream; a live event
// can also be in the history (storage records an event as the bus publishes it, before the daemon
// forwards it), so each event id is applied once. A card's place comes from its status alone, the
// task state machine of docs/07; task.assigned only names the agent (the core publishes it just
// before the change to in_progress). Agents follow their own events (agents.ts), and the Studio's
// signals theirs (signals.ts), the checkpoint list its own (checkpoints.ts). shortcut: messages come with the Studio's animations.

/** A task state of docs/07, as task.status.changed carries it. */
export type TaskStatus = Extract<
	MeteEvent,
	{ type: "task.status.changed" }
>["payload"]["to"];

/** One task as the Board shows it. */
export type TaskCard = {
	readonly id: string;
	readonly title: string;
	readonly roleId: string;
	/** The tasks this one waits for, by task id (the Flow view's edges). */
	readonly dependsOn: readonly string[];
	readonly agentId?: string;
	/** The role that approves the task, once it asked (not the human). */
	readonly approver?: string;
	/** The human's answer is what the task waits for: an approval it was asked for, or a block only the human can lift (ADR-091, docs/07). */
	readonly waitsForHuman?: true;
	/** The folder the submitted files wait in while the human decides, when the task has a worktree (ADR-132). */
	readonly worktree?: string;
	/** The files the task changed in that worktree, when the request lists them (ADR-141). */
	readonly files?: readonly string[];
	/** The task's latest report, relative to the workspace (docs/07, Artifact). */
	readonly artifactPath?: string;
	readonly status: TaskStatus;
};

/** What the views draw for a run, and the event ids already applied. */
export type TeamView = {
	readonly seen: ReadonlySet<string>;
	readonly tasks: readonly TaskCard[];
	readonly agents: readonly AgentCard[];
	readonly signals: RunSignals;
	readonly checkpoints: readonly CheckpointCard[];
	/**
	 * When the model call in flight began (ADR-125): the run's, not an agent's, since the first call
	 * of an agent starts before the agent exists. Tasks run one at a time, so one call is in flight.
	 */
	readonly thinkingSince?: string;
	/** The files the run's latest handoff lists as changed, as the agents named them (ADR-133). */
	readonly files?: readonly string[];
};

// What ends a model call in flight: its own end, or the run stopping while it waited.
const CALL_ENDS: ReadonlySet<string> = new Set([
	"agent.thinking.ended",
	"run.paused",
	"run.completed",
	"run.failed",
	"run.cancelled",
]);

const thinkingAfter = (since: string | undefined, e: MeteEvent) => {
	if (e.type === "agent.thinking.started") return { thinkingSince: e.ts };
	return since === undefined || CALL_ENDS.has(e.type)
		? {}
		: { thinkingSince: since };
};

// Each handoff lists every file the run changed so far, so the latest one stands alone.
const filesAfter = (files: readonly string[] | undefined, e: MeteEvent) => {
	const now = e.type === "handoff.created" ? e.payload.files : files;
	return now ? { files: now } : {};
};

/** The view before the first event. */
export const EMPTY_TEAM_VIEW: TeamView = {
	seen: new Set(),
	tasks: [],
	agents: [],
	signals: NO_SIGNALS,
	checkpoints: [],
};

/** A Board column, and the marker a card in it carries (ADR-051). */
export type Place = {
	readonly column: "todo" | "in_progress" | "done";
	readonly marker?: "in_review" | "changes_asked" | "blocked";
};

const PLACES: Readonly<Record<TaskStatus, Place>> = {
	todo: { column: "todo" },
	in_progress: { column: "in_progress" },
	submitted: { column: "in_progress", marker: "in_review" },
	changes_requested: { column: "in_progress", marker: "changes_asked" },
	blocked: { column: "in_progress", marker: "blocked" },
	approved: { column: "done" },
};

/** Where a task of this status sits on the Board. */
export const placeOf = (status: TaskStatus): Place => PLACES[status];

const update = (
	tasks: readonly TaskCard[],
	id: string | undefined,
	change: (card: TaskCard) => TaskCard,
) => tasks.map((t) => (t.id === id ? change(t) : t));

const tasksAfter = (
	tasks: readonly TaskCard[],
	e: MeteEvent,
): readonly TaskCard[] => {
	if (e.type === "task.created" && e.taskId)
		return [
			...tasks,
			{
				id: e.taskId,
				title: e.payload.title,
				roleId: e.payload.roleId,
				dependsOn: e.payload.dependsOn,
				status: "todo",
			},
		];
	if (e.type === "task.assigned")
		return update(tasks, e.taskId, (t) => ({
			...t,
			agentId: e.payload.agentId,
		}));
	if (e.type === "task.status.changed")
		return update(tasks, e.taskId, (t) => statusAfter(t, e.payload.to));
	if (e.type === "artifact.created" || e.type === "artifact.updated")
		return update(tasks, e.taskId, (t) => ({
			...t,
			artifactPath: e.payload.path,
		}));
	if (e.type === "approval.requested" || e.type === "approval.resolved")
		return update(tasks, e.taskId, (t) => approvalAfter(t, e));
	return tasks;
};

// A blocked task waits for the human (docs/07, Task state machine): the run pauses for approval,
// and only the human's instruction sends the task back to work (docs/08). Going back to work
// clears the mark; every other status leaves the approval mark alone, since it is the human's.
const statusAfter = (t: TaskCard, to: TaskStatus): TaskCard => {
	if (to === "blocked") return { ...t, status: to, waitsForHuman: true };
	if (t.status !== "blocked") return { ...t, status: to };
	const { waitsForHuman: _, ...rest } = t;
	return { ...rest, status: to };
};

// The approver role is kept for the Studio's bell (ADR-052); the human's turn is marked from its
// request until its decision, after any approver role's (ADR-091).
const approvalAfter = (
	t: TaskCard,
	e: Extract<MeteEvent, { type: "approval.requested" | "approval.resolved" }>,
): TaskCard => {
	if (e.payload.approver !== "human")
		return e.type === "approval.requested"
			? { ...t, approver: e.payload.approver }
			: t;
	// The latest request says where the files wait and which the task changed (ADR-132, ADR-141).
	const { waitsForHuman: _, worktree: __, files: ___, ...rest } = t;
	if (e.type === "approval.resolved") return rest;
	const { worktree, files } = e.payload;
	return {
		...rest,
		waitsForHuman: true,
		...(worktree ? { worktree } : {}),
		...(files ? { files } : {}),
	};
};

// The run's own events, and the workspace's quota events, which name no run (ADR-052).
const ofRun = (runId: string, e: MeteEvent) =>
	e.runId === runId || (e.runId === undefined && e.type.startsWith("quota."));

/** The view after one event of the run `runId`; an event seen before or of another run changes nothing. */
export const applyEvent = (
	runId: string,
	view: TeamView,
	e: MeteEvent,
): TeamView => {
	if (!ofRun(runId, e) || view.seen.has(e.id)) return view;
	const seen = new Set(view.seen).add(e.id);
	return {
		seen,
		tasks: tasksAfter(view.tasks, e),
		agents: agentsAfter(view.agents, e),
		signals: signalsAfter(view.signals, e),
		checkpoints: checkpointsAfter(view.checkpoints, e),
		...thinkingAfter(view.thinkingSince, e),
		...filesAfter(view.files, e),
	};
};

/** The view after the events, in order. */
export const applyAll = (
	runId: string,
	view: TeamView,
	events: readonly MeteEvent[],
): TeamView => events.reduce((v, e) => applyEvent(runId, v, e), view);
