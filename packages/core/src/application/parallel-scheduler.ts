import { TIER_MIN_CONTEXT } from "@mete/contracts";
import { TASKS_IN_FLIGHT } from "../defaults.js";
import { cutOld, type Split, toSummarize } from "../domain/compact.js";
import { nextStep } from "../domain/next-step.js";
import type { RunContext } from "../domain/run-machine.js";
import { taskContext } from "../domain/task-worker.js";
import { nextTeamStep, readyTasks, type TeamState } from "../domain/team.js";
import { activeSeat, isAsking, isWriter } from "../domain/team-run.js";
import { pinnedContext } from "./pinned.js";
import { apply, type EngineState, type Live } from "./run-state.js";
import { applyWorker } from "./task-worker.js";
import { startTask, teamTurn } from "./team-driver.js";
import { callWorker, type WorkerCall } from "./worker-call.js";
import { flushWorkerModel, settleWorker } from "./worker-result.js";

/** Per-drive calls; persisted sessions and reservations remain the source of truth. */
export const schedulerState = () => ({
	pending: new Map<string, WorkerCall>(),
	folds: new Map<string, Split>(),
	model: new AbortController(),
});
type Scheduler = ReturnType<typeof schedulerState>;

// Coordinator conversations and best-of-N keep their established sequential path in this slice.
const parallel = (team: TeamState, id: string) => {
	const task = team.template.tasks.find((t) => t.id === id);
	return (
		!isWriter(team, id) &&
		!task?.before_start?.clarify_with &&
		(task?.attempts?.n ?? 1) === 1
	);
};

const waiting = async (scheduler: Scheduler) => {
	await Promise.race([...scheduler.pending.values()].map((call) => call.wake));
	return true;
};

const waitForPending = (scheduler: Scheduler) =>
	scheduler.pending.size > 0 ? waiting(scheduler) : false;

const stillRunning = (live: Live, token: object) =>
	live.token === token && live.snapshot.value === "running";

const harvest = (state: EngineState, live: Live, scheduler: Scheduler) => {
	const ready = [...scheduler.pending.values()].find((call) => call.result);
	if (!ready) {
		const announced = [...scheduler.pending.values()].find(
			(call) => call.chunks.length > 0,
		);
		if (!announced) return false;
		flushWorkerModel(state, live, announced);
		return true;
	}
	scheduler.pending.delete(ready.task);
	const older = settleWorker(state, live, ready);
	if (older) scheduler.folds.set(ready.task, older);
	return true;
};

const workerContext = (state: EngineState, live: Live, task: string) => {
	const context = taskContext(live.snapshot.context, task);
	if (!context) return undefined;
	const cut = cutOld(context.messages);
	if (!cut) return context;
	applyWorker(state, live, task, { type: "CUT", messages: cut.messages });
	return taskContext(live.snapshot.context, task);
};

const reserve = (state: EngineState, live: Live, task: string) => {
	const reservation = state.deps.newId();
	const agentId = live.snapshot.context.team?.tasks[task]?.context.agentId;
	if (
		!agentId ||
		!apply(state, live, {
			type: "RESERVE",
			reservation: { id: reservation, task, agentId },
			limit: live.meta.budget.cloudRequests,
		})
	)
		return undefined;
	return reservation;
};

const launch = async (
	state: EngineState,
	live: Live,
	scheduler: Scheduler,
	task: string,
) => {
	if (scheduler.pending.size >= TASKS_IN_FLIGHT) return false;
	const context = workerContext(state, live, task);
	if (!context) return false;
	const token = live.token;
	const seat = await pinnedContext(state, context);
	if (live.token !== token || live.snapshot.value !== "running") return false;
	const reservation = reserve(state, live, task);
	if (!reservation) return false;
	const window =
		context.agent?.contextWindow ?? TIER_MIN_CONTEXT[activeSeat(context).tier];
	const split =
		scheduler.folds.get(task) ?? toSummarize(context.messages, window);
	scheduler.folds.delete(task);
	live.model = scheduler.model;
	const call = callWorker(state, live, {
		task,
		reservation,
		context,
		seat,
		split,
	});
	scheduler.pending.set(task, call);
	return true;
};

const coordinator = async (
	state: EngineState,
	live: Live,
	scheduler: Scheduler,
	team: TeamState,
) => {
	const busy = team.template.tasks.flatMap((t) =>
		team.tasks[t.id]?.status === "in_progress" ? [t.id] : [],
	);
	const next = nextTeamStep(team, busy);
	if (!["accept", "approve", "merge", "lesson"].includes(next.kind))
		return false;
	if (next.kind !== "accept" && scheduler.pending.size > 0)
		return waiting(scheduler);
	await teamTurn(state, live, team, busy);
	return true;
};

const workerStep = async (
	state: EngineState,
	live: Live,
	scheduler: Scheduler,
	task: string,
) => {
	const team = live.snapshot.context.team;
	if (!team || !parallel(team, task)) return "exclusive";
	const context = taskContext(live.snapshot.context, task);
	if (!context || !team.tasks[task]?.context.agentId) return "exclusive";
	const at = state.deps.now();
	const next = nextStep(context, live.meta.budget, at);
	if (next.kind === "model")
		return (await launch(state, live, scheduler, task)) ? "handled" : "idle";
	const onlyReserved =
		nextStep({ ...context, reservations: [] }, live.meta.budget, at).kind ===
		"model";
	if (next.kind === "pause" && scheduler.pending.size > 0 && onlyReserved)
		return "idle";
	apply(state, live, { type: "ACTIVATE", task });
	return "sequential";
};

const progress = async (
	state: EngineState,
	live: Live,
	scheduler: Scheduler,
	team: TeamState,
) => {
	const token = live.token;
	for (const task of team.template.tasks) {
		if (
			team.tasks[task.id]?.status !== "in_progress" ||
			scheduler.pending.has(task.id)
		)
			continue;
		const next = await workerStep(state, live, scheduler, task.id);
		if (live.token !== token || live.snapshot.value !== "running")
			return "handled";
		if (next !== "idle") return next;
	}
	return "idle";
};

const coordinating = (context: RunContext) =>
	context.review || context.clarify || context.judge || isAsking(context);

const startReady = async (
	state: EngineState,
	live: Live,
	scheduler: Scheduler,
	team: TeamState,
) => {
	const working = Object.values(team.tasks).filter(
		(t) => t.status === "in_progress",
	).length;
	const ready = readyTasks(team)[0];
	if (ready && working < TASKS_IN_FLIGHT && parallel(team, ready)) {
		await startTask(state, live, ready);
		return true;
	}
	return scheduler.pending.size > 0 ? waiting(scheduler) : false;
};

/** True when a scheduler action ran; false lets the existing sequential step own the real seat. */
export const schedule = async (
	state: EngineState,
	live: Live,
	scheduler: Scheduler,
): Promise<boolean> => {
	const context = live.snapshot.context;
	const token = live.token;
	const team = context.team;
	if (!team) return false;
	if (harvest(state, live, scheduler)) return true;
	if (coordinating(context)) return waitForPending(scheduler);
	if (await coordinator(state, live, scheduler, team)) return true;
	if (!stillRunning(live, token)) return true;
	const next = await progress(state, live, scheduler, team);
	if (!stillRunning(live, token)) return true;
	switch (next) {
		case "handled":
			return true;
		case "sequential":
			return false;
		case "exclusive":
			return waitForPending(scheduler);
		default:
			return startReady(state, live, scheduler, team);
	}
};

/** Retires every buffered call before another drive can seat workers. */
export const stopScheduler = async (
	state: EngineState,
	live: Live,
	scheduler: Scheduler,
) => {
	scheduler.model.abort();
	await Promise.all([...scheduler.pending.values()].map((call) => call.wait));
	for (const call of scheduler.pending.values())
		settleWorker(state, live, call);
	scheduler.pending.clear();
};
