import type {
	QuotaAmounts,
	QuotaObservation,
	QuotaUnitSpec,
} from "@mete/contracts";
import {
	keyOf,
	learn,
	limitOf,
	type PoolOptions,
	type PoolState,
	refresh,
	type State,
	specOf,
	stateAt,
	stateFor,
	UNLIMITED,
	type Unit,
} from "./pool-state.js";
import { type Entry, opensAt, prune, setUsage, usage } from "./windows.js";

export type { PoolOptions } from "./pool-state.js";

// The quota pool from docs/09 (Quota pool): limits, usage, unsettled holds and
// observations per provider, unit and scope. Times are epoch milliseconds.

/** Whether a call fits now; a wait without `opensAt` ends only when holds settle. */
export type Check =
	| { readonly kind: "open" }
	| { readonly kind: "never" }
	| { readonly kind: "wait"; readonly opensAt?: number };

/** Amounts held for one call until it settles. */
export type Held = {
	readonly providerId: string;
	readonly parts: readonly { readonly key: string; readonly amount: number }[];
};

/** An amount counted for a provider unit. */
export type Consumed = { providerId: string; unit: Unit; amount: number };

/** Counted usage of one unit and scope, for saving. */
export type UsageRow = {
	providerId: string;
	unit: Unit;
	scopeKey: string;
	entries: readonly Entry[];
};

/** A limit learned from responses, for saving. */
export type LimitRow = {
	providerId: string;
	unit: Unit;
	limit: number;
	source: "header" | "discovered";
};

/** Units that closed or opened, and the earliest time a closed one opens. */
export type Sweep = {
	closed: { providerId: string; unit: Unit; resetsAt: number }[];
	opened: { providerId: string; unit: Unit }[];
	next: number | undefined;
};

type Fits = Exclude<Check, { kind: "never" }>;

const OPEN: Fits = { kind: "open" };

// Request units count one per call unless told otherwise; other units count what is given.
const amountFor = (unit: Unit, amounts: QuotaAmounts) =>
	amounts[unit] ?? (unit.startsWith("requests_") ? 1 : 0);

// Both must open, so the later known time wins; a settle-only wait has no time.
const merge = (a: Fits, b: Fits): Fits => {
	if (a.kind === "open") return b;
	if (b.kind === "open" || b.opensAt === undefined) return a;
	return a.opensAt !== undefined && a.opensAt >= b.opensAt ? a : b;
};

// Where and when a call or an observation happens.
type At = { readonly modelId: string; readonly now: number };

const checkUnit = (
	ps: PoolState,
	s: QuotaUnitSpec,
	amounts: QuotaAmounts,
	{ modelId, now }: At,
): Check => {
	const { key, st } = stateFor(ps, s, modelId);
	refresh(ps, key, st, now);
	const amount = amountFor(s.unit, amounts);
	const limit = limitOf(ps, s);
	if (amount > limit) return { kind: "never" };
	if (st.resetAt !== undefined) return { kind: "wait", opensAt: st.resetAt };
	const fits = (u: number) =>
		amount === 0 ? u + st.pending < limit : u + st.pending + amount <= limit;
	if (fits(usage(s, st.entries, now))) return OPEN;
	const at = opensAt(s, st.entries, now, fits);
	return at === undefined ? { kind: "wait" } : { kind: "wait", opensAt: at };
};

const check = (
	ps: PoolState,
	providerId: string,
	amounts: QuotaAmounts,
	at: At,
): Check => {
	let result: Fits = OPEN;
	for (const s of ps.specs.get(providerId) ?? []) {
		const r = checkUnit(ps, s, amounts, at);
		if (r.kind === "never") return r;
		result = merge(result, r);
	}
	return result;
};

const hold = (
	ps: PoolState,
	providerId: string,
	modelId: string,
	amounts: QuotaAmounts,
): Held => {
	const parts = (ps.specs.get(providerId) ?? []).map((s) => {
		const { key, st } = stateFor(ps, s, modelId);
		const amount = amountFor(s.unit, amounts);
		st.pending += amount;
		return { key, amount };
	});
	return { providerId, parts };
};

const release = (ps: PoolState, held: Held) => {
	for (const { key, amount } of held.parts) {
		const st = ps.states.get(key);
		if (st) st.pending = Math.max(0, st.pending - amount);
	}
};

const record = (
	ps: PoolState,
	held: Held,
	actual: QuotaAmounts | null,
	now: number,
): Consumed[] => {
	release(ps, held);
	if (actual === null) return [];
	const consumed: Consumed[] = [];
	for (const { key } of held.parts) {
		const st = ps.states.get(key);
		const s = st && specOf(ps, st.providerId, st.unit);
		const amount = s ? amountFor(s.unit, actual) : 0;
		if (!st || !s || amount <= 0) continue;
		st.entries = [...prune(s, st.entries, now), { at: now, amount }];
		ps.dirtyUsage.add(key);
		consumed.push({ providerId: st.providerId, unit: st.unit, amount });
	}
	return consumed;
};

const observeUnit = (
	ps: PoolState,
	s: QuotaUnitSpec,
	o: QuotaObservation,
	{ modelId, now }: At,
) => {
	const { key, st } = stateFor(ps, s, modelId);
	refresh(ps, key, st, now);
	if (o.limit !== undefined) learn(ps, s, { header: o.limit });
	// An observation follows the record of the refused call that brought it; that call
	// is not part of the limit.
	const refused = amountFor(s.unit, {});
	if (o.exhausted && limitOf(ps, s) === UNLIMITED)
		learn(ps, s, {
			discovered: Math.max(1, usage(s, st.entries, now) - refused),
		});
	const remaining = o.exhausted ? 0 : o.remaining;
	const limit = limitOf(ps, s);
	if (remaining !== undefined && Number.isFinite(limit)) {
		st.entries = setUsage(s, st.entries, limit - remaining, now);
		ps.dirtyUsage.add(key);
	}
	const resetAt = o.resetsAt === undefined ? now : Date.parse(o.resetsAt);
	if (remaining === 0 && resetAt > now) st.resetAt = resetAt;
};

// The opening time of a closed unit, or undefined while it is open.
const closedUntil = (
	ps: PoolState,
	s: QuotaUnitSpec,
	st: State,
	now: number,
) => {
	if (st.resetAt !== undefined) return st.resetAt;
	const limit = limitOf(ps, s);
	if (usage(s, st.entries, now) < limit) return undefined;
	return opensAt(s, st.entries, now, (u) => u < limit) ?? now;
};

const sweep = (ps: PoolState, now: number): Sweep => {
	const out: Sweep = { closed: [], opened: [], next: undefined };
	for (const [key, st] of ps.states) {
		const s = specOf(ps, st.providerId, st.unit);
		if (!s) continue;
		refresh(ps, key, st, now);
		const until = closedUntil(ps, s, st, now);
		const unit = { providerId: st.providerId, unit: st.unit };
		if (until !== undefined && !st.closed)
			out.closed.push({ ...unit, resetsAt: until });
		if (until === undefined && st.closed) out.opened.push(unit);
		if (until !== undefined) out.next = Math.min(out.next ?? until, until);
		st.closed = until !== undefined;
	}
	return out;
};

const takeDirty = (
	ps: PoolState,
): { usage: UsageRow[]; limits: LimitRow[] } => {
	const rows = [...ps.dirtyUsage].flatMap((key) => {
		const st = ps.states.get(key);
		if (!st) return [];
		const { providerId, unit, scopeKey, entries } = st;
		return [{ providerId, unit, scopeKey, entries: [...entries] }];
	});
	const limits = [...ps.dirtyLimits].flatMap((key): LimitRow[] => {
		const l = ps.learned.get(key);
		const limit = l?.header ?? l?.discovered;
		if (!l || limit === undefined) return [];
		const source = l.header === undefined ? "discovered" : "header";
		return [{ providerId: l.providerId, unit: l.unit, limit, source }];
	});
	ps.dirtyUsage.clear();
	ps.dirtyLimits.clear();
	return { usage: rows, limits };
};

const load = (
	ps: PoolState,
	saved: { usage: readonly UsageRow[]; limits: readonly LimitRow[] },
) => {
	for (const row of saved.usage)
		stateAt(ps, row.providerId, row.unit, row.scopeKey).st.entries = [
			...row.entries,
		];
	for (const row of saved.limits)
		ps.learned.set(keyOf(row.providerId, row.unit), {
			providerId: row.providerId,
			unit: row.unit,
			...(row.source === "header"
				? { header: row.limit }
				: { discovered: row.limit }),
		});
};

const define = (ps: PoolState, list: readonly QuotaUnitSpec[]) => {
	for (const id of new Set(list.map((s) => s.providerId)))
		ps.specs.set(
			id,
			list.filter((s) => s.providerId === id),
		);
};

const observe = (
	ps: PoolState,
	providerId: string,
	observations: readonly QuotaObservation[],
	at: At,
) => {
	for (const o of observations) {
		const s = specOf(ps, providerId, o.unit);
		if (s) observeUnit(ps, s, o, at);
	}
};

const limitFor = (ps: PoolState, providerId: string, unit: Unit) => {
	const s = specOf(ps, providerId, unit);
	return s && limitOf(ps, s);
};

/** A quota pool over provider units; times are epoch milliseconds. */
export type Pool = {
	/** Sets the units of each provider named in `list`; counted usage is kept. */
	readonly define: (list: readonly QuotaUnitSpec[]) => void;
	readonly has: (providerId: string) => boolean;
	/** The effective limit of a defined unit. */
	readonly limit: (providerId: string, unit: Unit) => number | undefined;
	readonly check: (
		providerId: string,
		modelId: string,
		amounts: QuotaAmounts,
		now: number,
	) => Check;
	readonly hold: (
		providerId: string,
		modelId: string,
		amounts: QuotaAmounts,
	) => Held;
	readonly release: (held: Held) => void;
	/** Frees the hold and counts `actual`; null counts nothing (no call was sent). */
	readonly record: (
		held: Held,
		actual: QuotaAmounts | null,
		now: number,
	) => Consumed[];
	/** Applies a provider's observations; units it did not define are ignored. */
	readonly observe: (
		providerId: string,
		modelId: string,
		observations: readonly QuotaObservation[],
		now: number,
	) => void;
	/** Units that closed or opened since the last sweep, and the next opening. */
	readonly sweep: (now: number) => Sweep;
	/** Usage and learned limits changed since the last call. */
	readonly takeDirty: () => { usage: UsageRow[]; limits: LimitRow[] };
	/** Restores saved usage and learned limits without marking them changed. */
	readonly load: (saved: {
		usage: readonly UsageRow[];
		limits: readonly LimitRow[];
	}) => void;
};

/** Creates an empty pool; `define` adds provider units, `load` restores saved state. */
export const createPool = (opts: PoolOptions = {}): Pool => {
	const ps: PoolState = {
		opts,
		specs: new Map(),
		states: new Map(),
		learned: new Map(),
		dirtyUsage: new Set(),
		dirtyLimits: new Set(),
	};
	return {
		define: (list) => define(ps, list),
		has: (providerId) => ps.specs.has(providerId),
		limit: (providerId, unit) => limitFor(ps, providerId, unit),
		check: (providerId, modelId, amounts, now) =>
			check(ps, providerId, amounts, { modelId, now }),
		hold: (providerId, modelId, amounts) =>
			hold(ps, providerId, modelId, amounts),
		release: (held) => release(ps, held),
		record: (held, actual, now) => record(ps, held, actual, now),
		observe: (providerId, modelId, observations, now) =>
			observe(ps, providerId, observations, { modelId, now }),
		sweep: (now) => sweep(ps, now),
		takeDirty: () => takeDirty(ps),
		load: (saved) => load(ps, saved),
	};
};
