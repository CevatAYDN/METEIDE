import {
	err,
	type MeteEvent,
	ok,
	type QuotaAmounts,
	QuotaAmountsSchema,
	type QuotaObservation,
	QuotaObservationSchema,
	QuotaRequestSchema,
	type QuotaReserveAdapter,
	QuotaUnitSpecSchema,
	type QuotaUsage,
} from "@mete/contracts";
import type { Logger } from "@mete/kernel";
import type { Pool } from "../domain/pool.js";
import type { UnitUsage } from "../domain/pool-usage.js";
import type { QuotaStore } from "../infrastructure/quota-store.js";
import type { Granted, Scheduler, SchedulerOptions } from "./scheduler.js";

// quota.reserve@4 from docs/09 (Quota pool): reservations, settling, quota.* events
// and saving day and month usage.

type QuotaEvent = Extract<MeteEvent, { type: `quota.${string}` }>;

// One member per quota event type, so type and payload stay paired.
type QuotaEventBody = QuotaEvent extends infer E
	? E extends QuotaEvent
		? Pick<E, "type" | "payload">
		: never
	: never;

/** Publishes a quota event; the module adds the envelope. */
export type Emit = (body: QuotaEventBody, runId?: string) => void;

/** What the adapter works with; the module creates each part. */
export type ReserveDeps = {
	readonly pool: Pool;
	readonly scheduler: Scheduler;
	readonly store: QuotaStore;
	readonly emit: Emit;
	readonly logger: Logger;
	readonly now: () => number;
	readonly setTimer: SchedulerOptions["setTimer"];
};

type ReserveState = {
	readonly deps: ReserveDeps;
	readonly reservations: Map<string, { granted: Granted; runId: string }>;
	cancelTimer: (() => void) | undefined;
};

const iso = (ms: number) => new Date(ms).toISOString();

// The pool counts in epoch milliseconds; the contract speaks ISO 8601.
const toUsage = ({ resetsAt, history, ...row }: UnitUsage): QuotaUsage => ({
	...row,
	...(resetsAt === undefined ? {} : { resetsAt: iso(resetsAt) }),
	history: history.map((e) => ({ at: iso(e.at), amount: e.amount })),
});

const saveDirty = ({ pool, store, logger }: ReserveDeps) => {
	const dirty = pool.takeDirty();
	try {
		store.save(dirty);
	} catch (error) {
		pool.retryDirty(dirty);
		logger.error({ err: error }, "quota usage could not be saved");
	}
};

// Publishes closing and opening units, saves changes and waits for the next opening.
const afterChange = (st: ReserveState) => {
	const { pool, emit, now, setTimer } = st.deps;
	const at = now();
	const swept = pool.sweep(at);
	for (const c of swept.closed)
		emit({
			type: "quota.exhausted",
			payload: {
				providerId: c.providerId,
				unit: c.unit,
				resetsAt: iso(c.resetsAt),
			},
		});
	for (const payload of swept.opened) emit({ type: "quota.restored", payload });
	saveDirty(st.deps);
	st.cancelTimer?.();
	st.cancelTimer =
		swept.next === undefined
			? undefined
			: setTimer(() => afterChange(st), Math.max(0, swept.next - at));
};

// Observations a provider adapter made against the contract are dropped, not fatal: the
// reservation must be released whatever they look like.
const validObservations = (
	logger: Logger,
	observations: readonly QuotaObservation[],
) =>
	observations.flatMap((o) => {
		const p = QuotaObservationSchema.safeParse(o);
		if (p.success) return [p.data];
		logger.warn(
			{ observation: o, issues: p.error.issues },
			"quota observation ignored: not of the contract",
		);
		return [];
	});

const settle = (
	st: ReserveState,
	id: string,
	actual: QuotaAmounts | null,
	observations: readonly QuotaObservation[],
) => {
	const amounts = actual === null ? null : QuotaAmountsSchema.parse(actual);
	const entry = st.reservations.get(id);
	if (!entry) return err({ code: "unknown_reservation" as const, id });
	st.reservations.delete(id);
	const observed = validObservations(st.deps.logger, observations);
	const { held, providerId, modelId } = entry.granted;
	const at = st.deps.now();
	const consumed = st.deps.pool.record(held, amounts, at);
	st.deps.pool.observe(providerId, modelId, observed, at);
	for (const payload of consumed)
		st.deps.emit({ type: "quota.consumed", payload }, entry.runId);
	afterChange(st);
	st.deps.scheduler.wake();
	return ok(undefined);
};

/** Creates the quota.reserve@4 adapter; `dispose` stops its timers and waiters. */
export const createQuotaReserve = (deps: ReserveDeps) => {
	const st: ReserveState = {
		deps,
		reservations: new Map(),
		cancelTimer: undefined,
	};
	const adapter: QuotaReserveAdapter = {
		// Saved usage counts only once its provider is defined, and new limits may free waiters.
		define(specs) {
			deps.pool.define(specs.map((s) => QuotaUnitSpecSchema.parse(s)));
			afterChange(st);
			deps.scheduler.wake();
		},
		async reserve(req, signal) {
			const parsed = QuotaRequestSchema.parse(req);
			const r = await deps.scheduler.reserve(parsed, signal);
			if (!r.ok) return r;
			const id = crypto.randomUUID();
			st.reservations.set(id, { granted: r.value, runId: parsed.runId });
			const { providerId, modelId } = r.value;
			return ok({ id, providerId, modelId });
		},
		settle: (id, actual, observations) => settle(st, id, actual, observations),
		usage: () => deps.pool.usage(deps.now()).map(toUsage),
	};
	return {
		adapter,
		dispose() {
			st.cancelTimer?.();
			st.cancelTimer = undefined;
			deps.scheduler.dispose();
			saveDirty(deps);
		},
	};
};
