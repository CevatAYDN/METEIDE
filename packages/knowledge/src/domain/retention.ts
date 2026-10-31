import type { NoteType } from "@mete/contracts";
import { COLD_BELOW } from "../defaults.js";

// docs/11, Aging and restore (ADR-041, ADR-173): memory ages without a model call. Decisions and
// entities never age, and docs/11 gives inbox notes no salience, so only these two kinds can go cold.
const SALIENCE: Partial<Record<NoteType, number>> = {
	lesson: 0.8,
	journal: 0.5,
};

const DAY_MS = 86_400_000;

/** What aging reads of a note: its type, when it was written, its pin and its accesses. */
export type Aging = {
	readonly type: NoteType;
	/** The frontmatter's `created`, else its `updated`. */
	readonly born?: string | undefined;
	readonly pinned: boolean;
	readonly accesses: number;
	readonly lastAccess?: string | undefined;
};

// Days from an ISO time to now; 0 for a time that is missing, does not parse or lies ahead.
const daysSince = (iso: string | undefined, now: number) => {
	const at = iso === undefined ? Number.NaN : Date.parse(iso);
	return Number.isNaN(at) ? 0 : Math.max(0, (now - at) / DAY_MS);
};

/** docs/11: salience · e^(−0.02 · age in days) + 0.6 · ln(1 + accesses) · e^(−0.04 · days since the last access). */
export const retention = (salience: number, a: Aging, now: number) =>
	salience * Math.exp(-0.02 * daysSince(a.born, now)) +
	0.6 * Math.log1p(a.accesses) * Math.exp(-0.04 * daysSince(a.lastAccess, now));

/** A lesson or journal note without a pin whose retention score fell below COLD_BELOW. */
export const isCold = (a: Aging, now: number) => {
	const salience = SALIENCE[a.type];
	return (
		salience !== undefined &&
		!a.pinned &&
		retention(salience, a, now) < COLD_BELOW
	);
};
