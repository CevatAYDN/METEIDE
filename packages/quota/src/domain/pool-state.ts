import type { QuotaUnitSpec } from "@mete/contracts";
import type { Entry } from "./windows.js";

// The pool's state per provider, unit and scope, and the helpers that read and change it.

/** A quota unit name. */
export type Unit = QuotaUnitSpec["unit"];

/** The user's configured limit for a provider unit, when there is one. */
export type PoolOptions = {
	readonly settingsLimit?: (
		providerId: string,
		unit: Unit,
	) => number | undefined;
};

/** Counted usage, unsettled holds and a response reset of one unit and scope. */
export type State = {
	readonly providerId: string;
	readonly unit: Unit;
	readonly scopeKey: string;
	entries: Entry[];
	pending: number;
	resetAt: number | undefined;
	closed: boolean;
};

/** Limits learned from responses for one provider unit. */
export type Learned = {
	readonly providerId: string;
	readonly unit: Unit;
	header?: number;
	discovered?: number;
};

export const keyOf = (...parts: string[]) => parts.join("\u0000");
export const UNLIMITED = Number.POSITIVE_INFINITY;

const newState = (providerId: string, unit: Unit, scopeKey: string): State => ({
	providerId,
	unit,
	scopeKey,
	entries: [],
	pending: 0,
	resetAt: undefined,
	closed: false,
});

/** Everything a pool holds. */
export type PoolState = {
	readonly opts: PoolOptions;
	readonly specs: Map<string, readonly QuotaUnitSpec[]>;
	readonly states: Map<string, State>;
	readonly learned: Map<string, Learned>;
	readonly dirtyUsage: Set<string>;
	readonly dirtyLimits: Set<string>;
};

export const specOf = (ps: PoolState, providerId: string, unit: Unit) =>
	ps.specs.get(providerId)?.find((s) => s.unit === unit);

export const stateAt = (
	ps: PoolState,
	providerId: string,
	unit: Unit,
	scopeKey: string,
) => {
	const key = keyOf(providerId, unit, scopeKey);
	const st = ps.states.get(key) ?? newState(providerId, unit, scopeKey);
	ps.states.set(key, st);
	return { key, st };
};

export const stateFor = (ps: PoolState, s: QuotaUnitSpec, modelId: string) =>
	stateAt(ps, s.providerId, s.unit, s.scope === "model" ? modelId : "");

export const limitOf = (ps: PoolState, s: QuotaUnitSpec): number => {
	const l = ps.learned.get(keyOf(s.providerId, s.unit));
	const shipped = s.limit === "discover" ? UNLIMITED : s.limit;
	const configured = ps.opts.settingsLimit?.(s.providerId, s.unit);
	return configured ?? l?.header ?? l?.discovered ?? shipped;
};

export const learn = (
	ps: PoolState,
	s: QuotaUnitSpec,
	value: { header: number } | { discovered: number },
) => {
	const key = keyOf(s.providerId, s.unit);
	const base = { providerId: s.providerId, unit: s.unit };
	ps.learned.set(key, { ...base, ...ps.learned.get(key), ...value });
	ps.dirtyLimits.add(key);
};

// A response's reset time replaces the window: past it, older usage no longer counts.
export const refresh = (ps: PoolState, key: string, st: State, now: number) => {
	if (st.resetAt === undefined || now < st.resetAt) return;
	const from = st.resetAt;
	st.entries = st.entries.filter((e) => e.at >= from);
	st.resetAt = undefined;
	ps.dirtyUsage.add(key);
};
