import {
	type CapabilityRef,
	type PolicyRequest,
	type ToolContext,
	toolEntry,
} from "@mete/contracts";
import { z } from "zod";
import type { NextStep } from "../domain/next-step.js";
import { guarded } from "../domain/repeat.js";
import type { RunContext } from "../domain/run-machine.js";
import { taskContext } from "../domain/task-worker.js";
import { activeRole, activeSeat } from "../domain/team-run.js";
import { allowed } from "../domain/tools.js";
import { parkPolicyRequest, readPolicyRequest } from "./policy-wait.js";
import { type PreparedTool, preparedCurrent } from "./prepared-tool.js";
import { apply, type EngineState, emitAs, type Live } from "./run-state.js";
import { callTool, type ToolOutcome } from "./steps.js";
import { applyWorker } from "./task-worker.js";
import { checkpointWorker, clearWorkerFlight } from "./worker-checkpoint.js";

type ToolStep = Extract<NextStep, { kind: "tool" }>;
type ToolResult =
	| {
			readonly kind: "outcome";
			readonly out: ToolOutcome;
			readonly request?: PolicyRequest | undefined;
	  }
	| { readonly kind: "thrown"; readonly error: unknown }
	| { readonly kind: "stale" };

/** A started tool's immutable task identity; only the scheduler commits its buffered result. */
export type WorkerToolCall = {
	readonly task: string;
	readonly context: RunContext;
	readonly step: ToolStep;
	readonly prepared?: PreparedTool | undefined;
	readonly token: object;
	readonly pause: AbortSignal;
	readonly ctx: ToolContext;
	readonly as: {
		readonly taskId: string | undefined;
		readonly agentId: string;
	};
	wait: Promise<void>;
	wake: Promise<void>;
	result?: ToolResult;
	settled: boolean;
};

// These contracts are queries. Catalog `write` describes checkpoint needs, not side effects:
// vault appends, screenshots and audits can write even when that flag is absent.
const READ_ONLY = new Set<CapabilityRef>([
	"fs.read@1",
	"fs.list@1",
	"fs.glob@1",
	"fs.grep@1",
	"web.fetch@1",
	"web.search@1",
	"vault.read@1",
	"knowledge.search@1",
]);
const GitQuery = z.object({ op: z.enum(["status", "diff"]) });
const query = (ref: CapabilityRef, args: unknown) =>
	READ_ONLY.has(ref) ||
	(ref === "vcs.git@2" && GitQuery.safeParse(args).success);

/** Only known, permitted query capabilities enter the concurrent path. */
export const parallelTool = (context: RunContext, step: ToolStep) => {
	const entry = toolEntry(step.call.name);
	return (
		entry !== undefined &&
		query(entry.ref, step.call.args) &&
		!step.checkpoint &&
		allowed(activeSeat(context), entry.ref) &&
		entry.schema.safeParse(step.call.args).success
	);
};

// The exact assistant object distinguishes reused call ids and superseded task turns.
const ownsTool = (live: Live, call: WorkerToolCall, drain = false) => {
	const context = taskContext(live.snapshot.context, call.task);
	if (!context) return false;
	const message = context.messages[call.step.step];
	return (
		!call.settled &&
		!call.ctx.signal.aborted &&
		(live.token === call.token || (drain && call.pause.aborted)) &&
		(live.snapshot.value === "running" || live.snapshot.value === "paused") &&
		live.snapshot.context.team?.tasks[call.task]?.status === "in_progress" &&
		context.team?.tasks[call.task]?.context.agentId === call.as.agentId &&
		context.team?.tasks[call.task]?.context.worktree === call.ctx.cwd &&
		Boolean(context.tainted) === Boolean(call.ctx.tainted) &&
		message === call.context.messages[call.step.step] &&
		context.messages.findLastIndex((m) => m.role === "assistant") ===
			call.step.step &&
		!context.messages
			.slice(call.step.step + 1)
			.some((m) => m.role === "tool" && m.toolCallId === call.step.call.id)
	);
};

// Read-only adapters that ignore abort cannot hold cancellation or a later drive hostage.
const untilAbort = async <T>(work: Promise<T>, signal: AbortSignal) => {
	let abort = () => {};
	const stopped = new Promise<undefined>((resolve) => {
		abort = () => resolve(undefined);
		signal.addEventListener("abort", abort, { once: true });
		if (signal.aborted) abort();
	});
	try {
		return await Promise.race([work, stopped]);
	} finally {
		signal.removeEventListener("abort", abort);
	}
};

const runTool = async (
	state: EngineState,
	live: Live,
	call: WorkerToolCall,
): Promise<ToolResult> => {
	if (!ownsTool(live, call)) return { kind: "stale" };
	try {
		if (
			call.prepared &&
			call.step.checkpoint &&
			!(await checkpointTool(state, live, call))
		)
			return { kind: "stale" };
		if (!recordWriter(state, live, call)) return { kind: "stale" };
		const work = invokeTool(state, live, call);
		const out = call.prepared
			? await work
			: await untilAbort(work, call.ctx.signal);
		if (!out) return { kind: "stale" };
		const request =
			out.kind === "approval"
				? await untilAbort(
						readPolicyRequest(state.deps, live.meta.id, call.as.agentId),
						call.ctx.signal,
					)
				: undefined;
		return { kind: "outcome", out, request };
	} catch (error) {
		return { kind: "thrown", error };
	}
};

const recordWriter = (state: EngineState, live: Live, call: WorkerToolCall) =>
	!call.prepared ||
	(ownsTool(live, call) &&
		preparedCurrent(state.deps.registry, call.prepared) &&
		applyWorker(state, live, call.task, {
			type: "TOOL_STARTED",
			callId: call.step.call.id,
		}));

const checkpointTool = (state: EngineState, live: Live, call: WorkerToolCall) =>
	checkpointWorker(state, live, {
		task: call.task,
		step: call.step.step,
		ctx: call.ctx,
		as: call.as,
		checkpoint: call.prepared?.checkpoint,
		current: () =>
			ownsTool(live, call) &&
			!!call.prepared &&
			preparedCurrent(state.deps.registry, call.prepared),
	});

const invokeTool = (state: EngineState, live: Live, call: WorkerToolCall) =>
	callTool(
		state.deps,
		{
			call: call.step.call,
			seat: activeSeat(call.context),
			prepared: call.prepared,
		},
		call.ctx,
		(body) => {
			if (ownsTool(live, call, true)) emitAs(state, live, body, call.as);
		},
	);

const capturedContext = (
	live: Live,
	context: RunContext,
	agentId: string,
): ToolContext => {
	const cwd = context.task
		? context.team?.tasks[context.task]?.context.worktree
		: undefined;
	return {
		runId: live.meta.id,
		agentId,
		...(cwd ? { cwd } : {}),
		...(context.tainted ? { tainted: true } : {}),
		signal: live.all.signal,
	};
};

/** Starts a query or prepared writer using its captured agent, worktree, taint and stop signal. */
export const callWorkerTool = (
	state: EngineState,
	live: Live,
	input: {
		readonly task: string;
		readonly context: RunContext;
		readonly step: ToolStep;
		readonly prepared?: PreparedTool | undefined;
	},
) => {
	const { taskId, agentId } = activeRole(input.context);
	if (!agentId || (!parallelTool(input.context, input.step) && !input.prepared))
		throw new Error(
			"worker tool has no permitted query or prepared writer seat",
		);
	let notify = () => {};
	const call: WorkerToolCall = {
		...input,
		ctx: capturedContext(live, input.context, agentId),
		token: live.token,
		pause: live.model?.signal ?? new AbortController().signal,
		as: { taskId, agentId },
		wait: Promise.resolve(),
		wake: new Promise<void>((resolve) => {
			notify = resolve;
		}),
		settled: false,
	};
	call.wait = runTool(state, live, call).then((result) => {
		call.result = result;
		notify();
	});
	return call;
};

/** Applies a finished tool to the latest task session, including a paused drive's drain. */
export const settleWorkerTool = (
	state: EngineState,
	live: Live,
	call: WorkerToolCall,
	drain = false,
) => {
	const result = call.result;
	if (!result || !ownsTool(live, call, drain)) return;
	call.settled = true;
	if (result.kind === "thrown") throw result.error;
	if (result.kind === "stale") return;
	if (result.out.kind === "approval") {
		pauseForApproval(state, live, call, result.request);
		return;
	}
	const context = taskContext(live.snapshot.context, call.task);
	if (!context) return;
	const message = guarded(context.messages, call.step.call, result.out.message);
	if (message !== result.out.message)
		state.deps.logger.info(
			{
				runId: live.meta.id,
				taskId: call.as.taskId,
				tool: call.step.call.name,
			},
			"a tool call gave the same result again; the model is told so",
		);
	applyWorker(state, live, call.task, {
		type: "TOOL_DONE",
		message,
		...(result.out.external ? { external: true } : {}),
	});
};

const pauseForApproval = (
	state: EngineState,
	live: Live,
	call: WorkerToolCall,
	request: PolicyRequest | undefined,
) => {
	if (call.prepared) clearWorkerFlight(state, live, call.task);
	if (request && parkPolicyRequest(state, live, call.context, { request }))
		return;
	if (live.token === call.token)
		apply(state, live, {
			type: "PAUSE",
			at: state.deps.now(),
			reason: "approval",
		});
};
