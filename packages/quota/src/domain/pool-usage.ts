import type { QuotaUnitSpec } from "@mete/contracts";
import {
	limitOf,
	type PoolState,
	type State,
	UNLIMITED,
	type Unit,
} from "./pool-state.js";
import { type Entry, nextReset, prune } from "./windows.js";

// The pool read of quota.reserve@3 (docs/09, usage(); ADR-054): each defined unit as it stands,
// one row per scope. It never changes the state: a passed response reset is applied to a copy.

/** One unit and scope of the pool; times are epoch milliseconds. */
export type UnitUsage = {
	readonly providerId: string;
	readonly unit: Unit;
	readonly scope: string | null;
	readonly used: number;
	readonly limit: number | null;
	readonly resetsAt?: number;
	readonly history: readonly Entry[];
};

type Base = Pick<UnitUsage, "providerId" | "unit" | "limit">;

const scopeOf = (s: QuotaUnitSpec, st: State) =>
	s.scope === "model" ? st.scopeKey : null;

const rowOf = (base: Base, s: QuotaUnitSpec, st: State, now: number) => {
	const reset = st.resetAt;
	const passed = reset !== undefined && now >= reset;
	const entries = passed ? st.entries.filter((e) => e.at >= reset) : st.entries;
	const history = prune(s, entries, now);
	const resetsAt =
		reset !== undefined && !passed
			? reset
			: s.reset === "sliding"
				? undefined
				: nextReset(s, now);
	return {
		...base,
		scope: scopeOf(s, st),
		used: history.reduce((total, e) => total + e.amount, 0),
		history,
		...(resetsAt === undefined ? {} : { resetsAt }),
	};
};

const rowsOf = (ps: PoolState, s: QuotaUnitSpec, now: number): UnitUsage[] => {
	const limit = limitOf(ps, s);
	const base = {
		providerId: s.providerId,
		unit: s.unit,
		limit: limit === UNLIMITED ? null : limit,
	};
	const states = [...ps.states.values()].filter(
		(st) =>
			st.providerId === s.providerId &&
			st.unit === s.unit &&
			(s.scope === "model") === (st.scopeKey !== ""),
	);
	if (states.length > 0) return states.map((st) => rowOf(base, s, st, now));
	const resetsAt = s.reset === "sliding" ? undefined : nextReset(s, now);
	return [
		{
			...base,
			scope: null,
			used: 0,
			history: [],
			...(resetsAt === undefined ? {} : { resetsAt }),
		},
	];
};

/** Every defined unit at `now`, one row per scope it counted, or one row before it counted any. */
export const usageOf = (ps: PoolState, now: number): UnitUsage[] =>
	[...ps.specs.values()].flat().flatMap((s) => rowsOf(ps, s, now));
