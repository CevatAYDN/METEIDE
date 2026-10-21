import type { QuotaUnitSpec } from "@mete/contracts";
import { SLIDING_MONTH_DAYS } from "../defaults.js";

// Quota windows from docs/09 (Quota pool, windows). Times are epoch milliseconds,
// passed in, so the rules stay pure.

/** An amount counted at a time. */
export type Entry = { readonly at: number; readonly amount: number };

/** What a window depends on. */
export type WindowSpec = Pick<QuotaUnitSpec, "unit" | "reset">;

const MINUTE = 60_000;
const DAY = 86_400_000;

/** The length of a sliding window, taken from the unit name. */
export const windowLength = (unit: QuotaUnitSpec["unit"]): number => {
	if (unit.endsWith("_per_minute")) return MINUTE;
	if (unit.endsWith("_per_day")) return DAY;
	return SLIDING_MONTH_DAYS * DAY;
};

const periodStart = (spec: WindowSpec, now: number): number => {
	const d = new Date(now);
	if (spec.reset === "fixed_monthly")
		return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
	return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

/** The next 00:00 UTC reset of a fixed window. */
export const nextReset = (spec: WindowSpec, now: number): number => {
	const d = new Date(now);
	if (spec.reset === "fixed_monthly")
		return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
	return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
};

const counts = (spec: WindowSpec, now: number) =>
	spec.reset === "sliding"
		? (e: Entry) => e.at > now - windowLength(spec.unit)
		: (e: Entry) => e.at >= periodStart(spec, now);

const inWindow = (spec: WindowSpec, entries: readonly Entry[], now: number) =>
	entries.filter(counts(spec, now)).sort((a, b) => a.at - b.at);

/** The entries still counted at `now`, oldest first. */
export const prune = inWindow;

const sum = (entries: readonly Entry[]) =>
	entries.reduce((total, e) => total + e.amount, 0);

/** The amount counted in the window at `now`. */
export const usage = (
	spec: WindowSpec,
	entries: readonly Entry[],
	now: number,
): number => sum(inWindow(spec, entries, now));

/**
 * When the window's usage first satisfies `fits`: the next reset of a fixed window,
 * or the moment enough of the oldest amounts leave a sliding one. Undefined when
 * even an empty window does not fit.
 */
export const opensAt = (
	spec: WindowSpec,
	entries: readonly Entry[],
	now: number,
	fits: (usage: number) => boolean,
): number | undefined => {
	if (spec.reset !== "sliding")
		return fits(0) ? nextReset(spec, now) : undefined;
	const live = inWindow(spec, entries, now);
	let left = sum(live);
	for (const e of live) {
		left -= e.amount;
		if (fits(left)) return e.at + windowLength(spec.unit);
	}
	return undefined;
};

/** The window's entries changed so that their sum is `target`; amounts never go negative. */
export const setUsage = (
	spec: WindowSpec,
	entries: readonly Entry[],
	target: number,
	now: number,
): Entry[] => {
	const live = inWindow(spec, entries, now);
	let excess = sum(live) - Math.max(0, target);
	if (excess < 0) return [...live, { at: now, amount: -excess }];
	const kept: Entry[] = [];
	for (const e of live) {
		const cut = Math.min(e.amount, excess);
		excess -= cut;
		if (e.amount > cut) kept.push({ at: e.at, amount: e.amount - cut });
	}
	return kept;
};
