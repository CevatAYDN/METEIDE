import { MAX_TURNS } from "../defaults.js";
import type { RunContext, RunEvent } from "./run-types.js";
import { freshTaskSession, type TaskSession } from "./task-session-schema.js";

const SEAT_EVENTS: readonly RunEvent["type"][] = [
	"MODEL",
	"REPLIED",
	"TOOL_STARTED",
	"TOOL_DONE",
	"CHECKPOINTED",
	"CUT",
	"SUMMARIZED",
	"REPAIR",
];

/** Projects one worker's conversation without changing the coordinator or another task. */
export const taskContext = (
	run: RunContext,
	task: string,
): RunContext | undefined => {
	const entry = run.team?.tasks[task];
	if (!entry) return undefined;
	const session = entry.session ?? freshTaskSession();
	return {
		...run,
		task,
		messages: entry.messages,
		...session,
		agent: session.agent,
		snapshot: session.snapshot,
		inFlight: session.inFlight,
		review: undefined,
		clarify: undefined,
		judge: undefined,
	};
};

/** The task-local state retained after a worker step; run-wide counters stay on the run. */
export const taskSession = (context: RunContext): TaskSession => ({
	turns: context.turns,
	checkpointed: context.checkpointed,
	tainted: context.tainted === true,
	...(context.agent ? { agent: context.agent } : {}),
	...(context.snapshot ? { snapshot: context.snapshot } : {}),
	...(context.inFlight ? { inFlight: context.inFlight } : {}),
});

/** Only sequential seat mutations may copy shared fields back to a task session. */
export const syncSeatedWorker = (
	run: RunContext,
	event: RunEvent,
): RunContext => {
	if (!SEAT_EVENTS.includes(event.type)) return run;
	const { task, team } = run;
	if (!task || !team || run.review || run.clarify || run.judge) return run;
	const entry = team.tasks[task];
	if (
		entry?.status !== "in_progress" ||
		!entry.context.agentId ||
		(run.agent && run.agent.id !== entry.context.agentId)
	)
		return run;
	return {
		...run,
		team: {
			...team,
			tasks: {
				...team.tasks,
				[task]: {
					...entry,
					messages: [...run.messages],
					session: taskSession(run),
				},
			},
		},
	};
};

const resumeSeat = (run: RunContext): RunContext => {
	if (!run.task || run.review || run.clarify || run.judge) return run;
	return run.team?.tasks[run.task]?.status === "in_progress"
		? (taskContext(run, run.task) ?? run)
		: run;
};

/** Migrates the old active seat and resets only exhausted attempts when a paused run resumes. */
export const resumeWorkers = (run: RunContext): RunContext => {
	if (!run.team) return run;
	const tasks = { ...run.team.tasks };
	for (const [id, entry] of Object.entries(tasks)) {
		if (entry.status !== "in_progress") continue;
		const context = taskContext(run, id);
		if (!context) continue;
		const session = taskSession(context);
		tasks[id] = {
			...entry,
			messages: [...context.messages],
			session: {
				...session,
				turns: session.turns >= MAX_TURNS ? 0 : session.turns,
			},
		};
	}
	const next = { ...run, team: { ...run.team, tasks } };
	return resumeSeat(next);
};

/** Replaces only the named task while settling its reservation in the same snapshot update. */
export const workerProgress = (
	context: RunContext,
	event: Extract<RunEvent, { type: "WORKER" }>,
) => {
	const team = context.team;
	const entry = team?.tasks[event.task];
	if (!team || !entry) return {};
	return {
		requests: context.requests + event.requests,
		reservations: context.reservations?.filter(
			(r) => r.id !== event.reservation,
		),
		team: {
			...team,
			tasks: {
				...team.tasks,
				[event.task]: {
					...entry,
					messages: [...event.messages],
					session: event.session,
				},
			},
		},
	};
};

/** Seats task work atomically with its session; coordinator seats never replace a worker transcript. */
export const switchContext = (event: Extract<RunEvent, { type: "SWITCH" }>) => {
	const session = { ...(event.session ?? freshTaskSession()), ...event.state };
	const entry = event.team.tasks[event.task];
	const coordinator = event.review || event.clarify || event.judge;
	const team =
		coordinator || !entry
			? event.team
			: {
					...event.team,
					tasks: {
						...event.team.tasks,
						[event.task]: {
							...entry,
							messages: [...event.messages],
							session,
						},
					},
				};
	return {
		...session,
		task: event.task,
		team,
		messages: event.messages,
		agent: session.agent,
		snapshot: session.snapshot,
		inFlight: session.inFlight,
		review: event.review,
		clarify: event.clarify,
		judge: event.judge,
	};
};
