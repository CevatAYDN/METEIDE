import {
	err,
	ok,
	type QuotaRequest,
	type ReserveFailed,
	type Result,
} from "@mete/contracts";
import { QUOTA_WAIT_MAX_MS } from "../defaults.js";
import type { Check, Held, Pool } from "../domain/pool.js";

// The scheduler from docs/09 (Scheduler): priority classes, one call per run in turn,
// claims on providers that waiting calls need, and the 90-second wait.

/** Clock and timer, injected so tests control time. */
export type SchedulerOptions = {
	readonly pool: Pool;
	readonly now: () => number;
	readonly setTimer: (fn: () => void, ms: number) => () => void;
};

/** Capacity held on the chosen chain entry. */
export type Granted = {
	readonly held: Held;
	readonly providerId: string;
	readonly modelId: string;
};

/** Serves reservations; `wake` after every settle, `dispose` at deactivation. */
export type Scheduler = {
	readonly reserve: (
		req: QuotaRequest,
		signal: AbortSignal,
	) => Promise<Result<Granted, ReserveFailed>>;
	readonly wake: () => void;
	readonly dispose: () => void;
};

type Outcome = Result<Granted, ReserveFailed>;

type Waiter = {
	readonly req: QuotaRequest;
	readonly start: number;
	readonly done: (outcome: Outcome | Error) => void;
	opening: number | undefined;
};

type SchedulerState = {
	readonly opts: SchedulerOptions;
	// One map per class, P0 first; each maps a run id to its waiters in arrival order.
	readonly classes: readonly Map<string, Waiter[]>[];
	cancelTimer: (() => void) | undefined;
};

type Entry = QuotaRequest["chain"][number];

const checks = (st: SchedulerState, w: Waiter, now: number) =>
	w.req.chain.map((e): [Entry, Check] => [
		e,
		st.opts.pool.check(e.providerId, e.modelId, w.req.estimate, now),
	]);

// The earliest known opening, and whether some entry waits without a known time.
const openings = (list: readonly [Entry, Check][], claimed: Set<string>) => {
	let earliest: number | undefined;
	let unknown = false;
	for (const [e, c] of list) {
		if (c.kind === "never") continue;
		const at = c.kind === "wait" ? c.opensAt : undefined;
		if (claimed.has(e.providerId) || at === undefined) unknown = true;
		else earliest = Math.min(earliest ?? at, at);
	}
	return { earliest, unknown };
};

const exhausted = (resumesAt: number): Outcome =>
	err({
		code: "quota_exhausted",
		resumesAt: new Date(resumesAt).toISOString(),
	});

const remove = (st: SchedulerState, w: Waiter) => {
	const runs = st.classes[w.req.priority];
	const list = runs?.get(w.req.runId);
	if (!runs || !list) return;
	const rest = list.filter((x) => x !== w);
	if (rest.length > 0) runs.set(w.req.runId, rest);
	else runs.delete(w.req.runId);
};

// Serves, fails or blocks the head waiter of a run; blocked waiters claim their providers.
const tryServe = (
	st: SchedulerState,
	w: Waiter,
	claimed: Set<string>,
	now: number,
): "served" | "failed" | "blocked" => {
	const list = checks(st, w, now);
	if (list.every(([, c]) => c.kind === "never")) {
		w.done(new Error("quota: the estimate would never fit any chain entry"));
		return "failed";
	}
	const open = list.find(
		([e, c]) => c.kind === "open" && !claimed.has(e.providerId),
	);
	if (open) {
		const [{ providerId, modelId }] = open;
		const held = st.opts.pool.hold(providerId, modelId, w.req.estimate);
		w.done(ok({ held, providerId, modelId }));
		return "served";
	}
	const { earliest, unknown } = openings(list, claimed);
	if (
		!unknown &&
		earliest !== undefined &&
		earliest - now > QUOTA_WAIT_MAX_MS
	) {
		w.done(exhausted(earliest));
		return "failed";
	}
	w.opening = earliest;
	for (const [e, c] of list) if (c.kind !== "never") claimed.add(e.providerId);
	return "blocked";
};

const expire = (st: SchedulerState, now: number) => {
	for (const runs of st.classes)
		for (const list of [...runs.values()])
			for (const w of list) {
				if (now - w.start < QUOTA_WAIT_MAX_MS) continue;
				const { earliest } = openings(checks(st, w, now), new Set());
				remove(st, w);
				w.done(exhausted(earliest ?? now));
			}
};

// One pass gives each run's head one turn, P0 first; returns whether anything changed.
const pass = (st: SchedulerState): boolean => {
	const now = st.opts.now();
	expire(st, now);
	const claimed = new Set<string>();
	let changed = false;
	for (const runs of st.classes)
		for (const [runId, list] of [...runs]) {
			const head = list[0];
			if (!head) continue;
			const result = tryServe(st, head, claimed, now);
			if (result === "blocked") continue;
			// Deleting and setting again moves the run to the back of its class.
			changed = true;
			runs.delete(runId);
			if (list.length > 1) runs.set(runId, list.slice(1));
		}
	return changed;
};

const schedule = (st: SchedulerState) => {
	st.cancelTimer?.();
	st.cancelTimer = undefined;
	let next: number | undefined;
	for (const runs of st.classes)
		for (const list of runs.values())
			for (const w of list) {
				const deadline = w.start + QUOTA_WAIT_MAX_MS;
				const at = Math.min(deadline, w.opening ?? deadline);
				next = Math.min(next ?? at, at);
			}
	if (next === undefined) return;
	const delay = Math.max(0, next - st.opts.now());
	st.cancelTimer = st.opts.setTimer(() => drain(st), delay);
};

const drain = (st: SchedulerState) => {
	while (pass(st));
	schedule(st);
};

const enqueue = (st: SchedulerState, req: QuotaRequest, signal: AbortSignal) =>
	new Promise<Outcome>((resolve, reject) => {
		const onAbort = () => {
			remove(st, w);
			w.done(err({ code: "aborted" }));
			drain(st);
		};
		const w: Waiter = {
			req,
			start: st.opts.now(),
			opening: undefined,
			done: (outcome) => {
				signal.removeEventListener("abort", onAbort);
				if (outcome instanceof Error) reject(outcome);
				else resolve(outcome);
			},
		};
		signal.addEventListener("abort", onAbort, { once: true });
		const runs = st.classes[req.priority];
		runs?.set(req.runId, [...(runs.get(req.runId) ?? []), w]);
		drain(st);
	});

const reserve = async (
	st: SchedulerState,
	req: QuotaRequest,
	signal: AbortSignal,
): Promise<Outcome> => {
	const missing = req.chain.find((e) => !st.opts.pool.has(e.providerId));
	if (missing)
		throw new Error(`quota: provider ${missing.providerId} is not defined`);
	if (signal.aborted) return err({ code: "aborted" });
	return enqueue(st, req, signal);
};

const dispose = (st: SchedulerState) => {
	st.cancelTimer?.();
	st.cancelTimer = undefined;
	for (const runs of st.classes) {
		const waiters = [...runs.values()].flat();
		runs.clear();
		for (const w of waiters) w.done(err({ code: "aborted" }));
	}
};

/** Creates a scheduler over a pool. */
export const createScheduler = (opts: SchedulerOptions): Scheduler => {
	const st: SchedulerState = {
		opts,
		classes: [new Map(), new Map(), new Map()],
		cancelTimer: undefined,
	};
	return {
		reserve: (req, signal) => reserve(st, req, signal),
		wake: () => drain(st),
		dispose: () => dispose(st),
	};
};
