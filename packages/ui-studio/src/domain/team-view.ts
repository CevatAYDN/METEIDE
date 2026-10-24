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
		return update(tasks, e.taskId, (t) => ({ ...t, status: e.payload.to }));
	if (e.type === "artifact.created" || e.type === "artifact.updated")
		return update(tasks, e.taskId, (t) => ({
			...t,
			artifactPath: e.payload.path,
		}));
	if (e.type === "approval.requested" && e.payload.approver !== "human")
		return update(tasks, e.taskId, (t) => ({
			...t,
			approver: e.payload.approver,
		}));
	return tasks;
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
	};
};

/** The view after the events, in order. */
export const applyAll = (
	runId: string,
	view: TeamView,
	events: readonly MeteEvent[],
): TeamView => events.reduce((v, e) => applyEvent(runId, v, e), view);
