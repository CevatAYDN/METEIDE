import type { MeteEvent, RunView } from "@mete/contracts";

// What `mete run` and `mete status` print (ARCHITECTURE.md, CLI). Pure.

const model = (m: { providerId: string; modelId: string }) =>
	`${m.providerId}/${m.modelId}`;

const runLine = (e: MeteEvent): string | undefined => {
	switch (e.type) {
		case "run.started":
			return `run ${e.runId ?? ""} started`;
		case "run.paused": {
			const until = e.payload.resumesAt ? ` until ${e.payload.resumesAt}` : "";
			return `paused: ${e.payload.reason}${until}`;
		}
		case "run.resumed":
			return "resumed";
		case "run.completed":
			return `completed\n${e.payload.summary}`;
		case "run.failed":
			return `failed: ${e.payload.code} ${e.payload.message}`.trimEnd();
		case "run.cancelled":
			return "cancelled";
		default:
			return undefined;
	}
};

const agentLine = (e: MeteEvent): string | undefined => {
	switch (e.type) {
		case "agent.created":
			return `model ${model(e.payload)}`;
		case "agent.model.changed":
			return `model ${model(e.payload.from)} -> ${model(e.payload.to)} (${e.payload.reason})`;
		case "agent.tool.called":
			return `tool  ${e.payload.capability}`;
		case "agent.tool.completed": {
			const ms = Math.round(e.payload.durationMs);
			const why = e.payload.error ? ` (${e.payload.error.code})` : "";
			return `      ${e.payload.ok ? "ok" : "failed"}${why} in ${ms} ms`;
		}
		case "checkpoint.created":
			return `checkpoint ${e.payload.ref}`;
		default:
			return undefined;
	}
};

// A team run's tasks are named by their titles, as task.created gave them.
const teamLine = (e: MeteEvent, title: string): string | undefined => {
	switch (e.type) {
		case "task.created":
			return `task  ${e.payload.title} (${e.payload.roleId})`;
		case "task.status.changed":
			return `task  ${title}: ${e.payload.to}`;
		case "task.merge.failed":
			return `task  ${title}: merge failed (${e.payload.message}); the branch ${e.payload.branch} and its worktree are kept, so fix the cause and approve the task to merge again`;
		case "approval.requested":
			return `waiting for ${e.payload.approver}: ${title}`;
		case "approval.resolved": {
			const what =
				e.payload.decision === "approve" ? "approved" : "asked for changes";
			const why = e.payload.feedback ? ` (${e.payload.feedback})` : "";
			return `${e.payload.approver} ${what}: ${title}${why}`;
		}
		case "artifact.created":
		case "artifact.updated":
			return `artifact ${e.payload.path}`;
		case "handoff.created":
			return `handoff ${e.payload.handoffId} left for the next run`;
		case "handoff.accepted":
			return `handoff ${e.payload.handoffId} taken by run ${e.payload.byRunId}`;
		default:
			return undefined;
	}
};

/** One terminal line for an event of the run, or undefined for events it does not show. */
export const eventLine = (
	e: MeteEvent,
	titleOf: (taskId: string) => string | undefined = () => undefined,
) => {
	const id = e.taskId ?? "";
	return (
		runLine(e) ?? agentLine(e) ?? teamLine(e, titleOf(id) ?? id.slice(0, 8))
	);
};

/** The exit code of `mete run` for the state the run ended in. */
export const exitCode = (status: RunView["status"]) =>
	status === "completed" ? 0 : status === "paused" ? 2 : 1;

/** `mete status` as aligned text lines, newest run first. */
export const statusLines = (runs: readonly RunView[]) =>
	runs.length === 0
		? ["no runs"]
		: runs.map((r) => {
				const state = r.pauseReason
					? `${r.status}(${r.pauseReason})`
					: r.status;
				return `${r.id}  ${state.padEnd(16)}  ${r.goal}`;
			});

/** The task titles and agent roles of a run, from its task.created and agent.created events. */
export const namesOf = (events: readonly MeteEvent[]) => {
	const titles = new Map<string, string>();
	const roles = new Map<string, string>();
	for (const e of events) {
		if (e.type === "task.created" && e.taskId)
			titles.set(e.taskId, e.payload.title);
		if (e.type === "agent.created" && e.agentId)
			roles.set(e.agentId, e.payload.roleId);
	}
	return { titles, roles };
};

/**
 * One `mete events` line: when, which event, the module that published it, the task and the
 * agent's role, and what happened. An event mete run does not show keeps its payload as JSON.
 */
export const historyLine = (
	e: MeteEvent,
	names: ReturnType<typeof namesOf>,
) => {
	const name = (map: ReadonlyMap<string, string>, id: string) =>
		map.get(id) ?? id.slice(0, 8);
	const task = e.taskId ? `  task=${name(names.titles, e.taskId)}` : "";
	const agent = e.agentId ? `  agent=${name(names.roles, e.agentId)}` : "";
	const line = eventLine(e, (id) => names.titles.get(id));
	const detail =
		line?.trim().replaceAll("\n", " | ") ?? JSON.stringify(e.payload);
	return `${e.ts}  ${e.type.padEnd(22)} ${e.source}${task}${agent}  ${detail}`;
};
