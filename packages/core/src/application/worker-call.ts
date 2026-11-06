import type { LlmChunk } from "@mete/contracts";
import { type Split, summaryRequest } from "../domain/compact.js";
import type { RunContext } from "../domain/run-machine.js";
import { activeRole } from "../domain/team-run.js";
import type { Seat } from "../domain/tools.js";
import { type EngineState, emitAs, type Live } from "./run-state.js";
import { callModel, type ModelOutcome } from "./steps.js";

type ModelChunk = Extract<LlmChunk, { type: "model" }>;
type WorkerResult =
	| { readonly kind: "outcome"; readonly out: ModelOutcome }
	| { readonly kind: "thrown"; readonly error: unknown }
	| { readonly kind: "stale" };

/** A captured attempt identity and buffered outcome; only the coordinator commits its result. */
export type WorkerCall = {
	readonly task: string;
	readonly reservation: string;
	readonly context: RunContext;
	readonly seat: Seat;
	readonly token: object;
	readonly as: {
		readonly taskId: string | undefined;
		readonly agentId: string;
	};
	readonly chunks: ModelChunk[];
	readonly split?: Split | undefined;
	wait: Promise<void>;
	wake: Promise<void>;
	notify: () => void;
	result?: WorkerResult | undefined;
};

/** Arms the coordinator's next notification without letting callbacks mutate snapshots. */
export const listenWorker = (call: WorkerCall) => {
	call.wake = new Promise<void>((resolve) => {
		call.notify = resolve;
	});
};

/** A paused or superseded worker never owns callbacks of a resumed run. */
export const ownsWorker = (live: Live, call: WorkerCall) =>
	live.token === call.token &&
	live.snapshot.value === "running" &&
	live.snapshot.context.reservations?.some((r) => r.id === call.reservation) ===
		true &&
	live.snapshot.context.team?.tasks[call.task]?.context.agentId ===
		call.as.agentId;

// Some adapters finish late even after abort. Detach their result without holding up resume.
const untilAbort = async (work: Promise<ModelOutcome>, signal: AbortSignal) => {
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

const request = (
	state: EngineState,
	live: Live,
	call: WorkerCall,
	signal: AbortSignal,
) => {
	const seat = call.split
		? { tier: "fast" as const, needs: [], capabilities: [] }
		: call.seat;
	if (!ownsWorker(live, call) || signal.aborted) return undefined;
	const messages = call.split
		? summaryRequest(call.split.middle)
		: call.context.messages;
	const run = {
		runId: live.meta.id,
		priority: call.context.priority,
		messages,
		seat,
	};
	return untilAbort(
		callModel(
			state.deps,
			run,
			(chunk) => {
				if (ownsWorker(live, call) && !signal.aborted) {
					call.chunks.push(chunk);
					call.notify();
				}
			},
			signal,
		),
		signal,
	);
};

const run = async (
	state: EngineState,
	live: Live,
	call: WorkerCall,
): Promise<WorkerResult> => {
	const model = live.model ?? new AbortController();
	live.model = model;
	const signal = AbortSignal.any([live.all.signal, model.signal]);
	if (!call.split)
		emitAs(
			state,
			live,
			{ type: "agent.thinking.started", payload: {} },
			call.as,
		);
	try {
		const out = await request(state, live, call, signal);
		return out ? { kind: "outcome", out } : { kind: "stale" };
	} catch (error) {
		return { kind: "thrown", error };
	}
};

/** Begins a reserved call without swapping or cloning Live; outcomes wait for the coordinator. */
export const callWorker = (
	state: EngineState,
	live: Live,
	input: {
		readonly task: string;
		readonly reservation: string;
		readonly context: RunContext;
		readonly seat: Seat;
		readonly split?: Split | undefined;
	},
) => {
	const { agentId, taskId } = activeRole(input.context);
	if (!agentId) throw new Error("worker has no assigned agent");
	const call: WorkerCall = {
		...input,
		token: live.token,
		chunks: [],
		as: { taskId, agentId },
		wait: Promise.resolve(),
		wake: Promise.resolve(),
		notify: () => {},
	};
	listenWorker(call);
	call.wait = run(state, live, call).then((result) => {
		call.result = result;
		call.notify();
	});
	return call;
};
