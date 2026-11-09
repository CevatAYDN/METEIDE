import { TIER_MIN_CONTEXT } from "@mete/contracts";
import { TASKS_IN_FLIGHT } from "../defaults.js";
import { cutOld, type Split, toSummarize } from "../domain/compact.js";
import { nextStep } from "../domain/next-step.js";
import type { RunContext } from "../domain/run-machine.js";
import { pinnedFor } from "../domain/skill-pinned.js";
import { currentWait } from "../domain/task-wait.js";
import { taskContext } from "../domain/task-worker.js";
import { nextTeamStep, readyTasks, type TeamState } from "../domain/team.js";
import { activeSeat, isWriter } from "../domain/team-run.js";
import { progressOrControl } from "./control-turn.js";
import { pinnedContext } from "./pinned.js";
import { type PreparedTool, rootsOverlap } from "./prepared-tool.js";
import { apply, type EngineState, type Live } from "./run-state.js";
import {
	coordinatorStep,
	needsSetup,
	setupStep,
	verifies,
} from "./scheduler-coordination.js";
import { ensureExplicitSkills } from "./skill-explicit.js";
import { resumeTaskContinuation } from "./task-continuation.js";
import { applyWorker } from "./task-worker.js";
import { startTask, teamTurn } from "./team-driver.js";
import { callWorker, type WorkerCall } from "./worker-call.js";
import { inspectWorkerWriter } from "./worker-checkpoint.js";
import { flushWorkerModel, settleWorker } from "./worker-result.js";
import {
	callWorkerTool,
	parallelTool,
	settleWorkerTool,
	type WorkerToolCall,
} from "./worker-tool.js";

export type Pending =
	| { readonly kind: "model"; readonly call: WorkerCall }
	| { readonly kind: "tool"; readonly call: WorkerToolCall };

/** Per-drive calls; persisted sessions and reservations remain the source of truth. */
export const schedulerState = () => ({
	pending: new Map<string, Pending>(),
	preparing: new Set<string>(),
	folds: new Map<string, Split>(),
	model: new AbortController(),
});
export type Scheduler = ReturnType<typeof schedulerState>;

const occupied = (scheduler: Scheduler) =>
	scheduler.pending.size + scheduler.preparing.size;

// Coordinator conversations and best-of-N keep their established sequential path in this slice.
const parallel = (team: TeamState, id: string) => {
	const task = team.template.tasks.find((t) => t.id === id);
	return !task?.before_start?.clarify_with && (task?.attempts?.n ?? 1) === 1;
};
const parallelRole = (team: TeamState, id: string) =>
	!isWriter(team, id) || !!team.tasks[id]?.context.worktree;

const waiting = async (live: Live, scheduler: Scheduler) => {
	await progressOrControl(
		live,
		Promise.race([...scheduler.pending.values()].map(({ call }) => call.wake)),
	);
	return true;
};

const waitForPending = (live: Live, scheduler: Scheduler) =>
	scheduler.pending.size > 0 ? waiting(live, scheduler) : false;

const stillRunning = (live: Live, token: object) =>
	live.token === token && live.snapshot.value === "running";

const harvest = (state: EngineState, live: Live, scheduler: Scheduler) => {
	const ready = [...scheduler.pending.values()].find(({ call }) => call.result);
	if (!ready) {
		const announced = [...scheduler.pending.values()].find(
			(pending) => pending.kind === "model" && pending.call.chunks.length > 0,
		);
		if (announced?.kind !== "model") return false;
		flushWorkerModel(state, live, announced.call);
		return true;
	}
	scheduler.pending.delete(ready.call.task);
	if (ready.kind === "tool") settleWorkerTool(state, live, ready.call);
	else {
		const older = settleWorker(state, live, ready.call);
		if (older) scheduler.folds.set(ready.call.task, older);
	}
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
	if (occupied(scheduler) >= TASKS_IN_FLIGHT) return "idle";
	const context = workerContext(state, live, task);
	if (!context) return "idle";
	const token = live.token;
	const prepared = ensureExplicitSkills(state, live, token, context);
	if (prepared !== true) {
		await prepared;
		return "handled";
	}
	const seat = await pinnedContext(state, context);
	if (live.token !== token || live.snapshot.value !== "running") return "idle";
	const reservation = reserve(state, live, task);
	if (!reservation) return "idle";
	const window =
		context.agent?.contextWindow ?? TIER_MIN_CONTEXT[activeSeat(context).tier];
	const split =
		scheduler.folds.get(task) ??
		toSummarize(context.messages, window, pinnedFor(context));
	scheduler.folds.delete(task);
	live.model = scheduler.model;
	const call = callWorker(state, live, {
		task,
		reservation,
		context,
		seat,
		split,
	});
	scheduler.pending.set(task, { kind: "model", call });
	return "handled";
};

const coordinator = async (
	state: EngineState,
	live: Live,
	scheduler: Scheduler,
) => {
	const token = live.token;
	if (await resumeCoordinator(state, live, scheduler)) return true;
	if (!stillRunning(live, token)) return true;
	const team = live.snapshot.context.team;
	if (!team) return false;
	const busy = team.template.tasks.flatMap((t) =>
		team.tasks[t.id]?.status === "in_progress" ? [t.id] : [],
	);
	const next = nextTeamStep(team, busy);
	if (!["accept", "approve", "merge", "lesson"].includes(next.kind))
		return false;
	if (next.kind !== "accept" && scheduler.pending.size > 0)
		return waiting(live, scheduler);
	await teamTurn(state, live, team, busy);
	return true;
};

const prepareSlot = async (
	state: EngineState,
	live: Live,
	scheduler: Scheduler,
	input: Parameters<typeof callWorkerTool>[2],
) => {
	scheduler.preparing.add(input.task);
	try {
		return await inspectWorkerWriter(state, live, input);
	} finally {
		scheduler.preparing.delete(input.task);
	}
};

const rootBusy = (scheduler: Scheduler, prepared: PreparedTool | undefined) =>
	prepared !== undefined &&
	[...scheduler.pending.values()].some(
		(p) =>
			p.kind === "tool" &&
			p.call.prepared &&
			rootsOverlap(prepared.root, p.call.prepared.root),
	);

const launchTool = async (
	state: EngineState,
	live: Live,
	scheduler: Scheduler,
	input: Parameters<typeof callWorkerTool>[2],
) => {
	if (occupied(scheduler) >= TASKS_IN_FLIGHT) return "idle";
	let prepared: PreparedTool | undefined;
	if (!parallelTool(input.context, input.step)) {
		const checked = await prepareSlot(state, live, scheduler, input);
		if (!checked.current) return "idle";
		prepared = checked.prepared;
		if (!prepared)
			return scheduler.pending.size > 0 ? "exclusive" : "sequential";
	}
	if (rootBusy(scheduler, prepared)) return "exclusive";
	live.model = scheduler.model;
	const call = callWorkerTool(state, live, { ...input, prepared });
	scheduler.pending.set(input.task, { kind: "tool", call });
	return "handled";
};

const reservedPause = (
	context: RunContext,
	live: Live,
	scheduler: Scheduler,
	at: number,
) =>
	scheduler.pending.size > 0 &&
	nextStep(context, live.meta.budget, at).kind === "pause" &&
	nextStep({ ...context, reservations: [] }, live.meta.budget, at).kind ===
		"model";

const exclusiveTask = (
	state: EngineState,
	live: Live,
	scheduler: Scheduler,
	task: string,
) => {
	if (occupied(scheduler) > 0) return "exclusive";
	apply(state, live, { type: "ACTIVATE", task });
	return "sequential";
};

const availableWorker = (team: TeamState | undefined, task: string) =>
	!!team &&
	parallel(team, task) &&
	!!team.tasks[task]?.context.agentId &&
	parallelRole(team, task);

const workerStep = async (
	state: EngineState,
	live: Live,
	scheduler: Scheduler,
	task: string,
) => {
	const team = live.snapshot.context.team;
	if (needsSetup(team?.tasks[task]))
		return setupStep(state, live, task, occupied(scheduler));
	const context = taskContext(live.snapshot.context, task);
	if (!context || !availableWorker(team, task))
		return exclusiveTask(state, live, scheduler, task);
	const at = state.deps.now();
	if (context.inFlight) {
		apply(state, live, { type: "PAUSE", at, reason: "user" });
		return "handled";
	}
	const next = nextStep(context, live.meta.budget, at);
	if (next.kind === "model") return launch(state, live, scheduler, task);
	if (next.kind === "tool") {
		const tooling = await launchTool(state, live, scheduler, {
			task,
			context,
			step: next,
		});
		if (tooling !== "sequential") return tooling;
	}
	if (reservedPause(context, live, scheduler, at)) return "idle";
	if (verifies(context, next))
		return exclusiveTask(state, live, scheduler, task);
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
			currentWait(team.tasks[task.id]) ||
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

const startReady = async (
	state: EngineState,
	live: Live,
	scheduler: Scheduler,
) => {
	const team = live.snapshot.context.team;
	if (!team) return false;
	const active = Object.entries(team.tasks).filter(
		([, task]) => task.status === "in_progress" && !currentWait(task),
	);
	if (
		scheduler.preparing.size > 0 ||
		[...scheduler.pending.values()].some((p) => p.kind === "tool") ||
		active.some(([id]) => !parallelRole(team, id))
	)
		return false;
	const working = Object.values(team.tasks).filter(
		(t) => t.status === "in_progress" && !currentWait(t),
	).length;
	const ready = readyTasks(team)[0];
	if (ready && working < TASKS_IN_FLIGHT && parallel(team, ready)) {
		await startTask(state, live, ready);
		return true;
	}
	return false;
};

const resumeCoordinator = async (
	state: EngineState,
	live: Live,
	scheduler: Scheduler,
) => {
	const tasks = Object.values(live.snapshot.context.team?.tasks ?? {});
	if (!tasks.some((entry) => entry.continuation && !currentWait(entry)))
		return false;
	return scheduler.pending.size > 0
		? waiting(live, scheduler)
		: resumeTaskContinuation(state, live);
};

/** True when a scheduler action ran; false lets the existing sequential step own the real seat. */
export const schedule = async (
	state: EngineState,
	live: Live,
	scheduler: Scheduler,
): Promise<boolean> => {
	const token = live.token;
	if (!live.snapshot.context.team) return false;
	if (harvest(state, live, scheduler)) return true;
	const coordination = await coordinatorStep(state, live, occupied(scheduler));
	if (!stillRunning(live, token)) return true;
	if (coordination)
		return coordination === "handled" || waitForPending(live, scheduler);
	if (await coordinator(state, live, scheduler)) return true;
	if (!stillRunning(live, token)) return true;
	if (await startReady(state, live, scheduler)) return true;
	if (!stillRunning(live, token)) return true;
	return continueWorkers(state, live, scheduler);
};

const continueWorkers = async (
	state: EngineState,
	live: Live,
	scheduler: Scheduler,
) => {
	const team = live.snapshot.context.team;
	if (!team) return false;
	const token = live.token;
	const next = await progress(state, live, scheduler, team);
	if (!stillRunning(live, token)) return true;
	switch (next) {
		case "handled":
			return true;
		case "sequential":
			return false;
		case "exclusive":
			return waitForPending(live, scheduler);
		default:
			return (
				(await startReady(state, live, scheduler)) ||
				waitForPending(live, scheduler)
			);
	}
};
