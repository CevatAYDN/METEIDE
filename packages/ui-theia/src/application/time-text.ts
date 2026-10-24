// The panels' times (ADR-092): absolute, never a ticking clock, so a test and a screenshot read the
// same.

/** A whole time, for a tooltip. */
export const when = (iso: string) => new Date(iso).toLocaleString();

const HOUR = { hour: "2-digit", minute: "2-digit" } as const;

/**
 * A run's time as the narrow list shows it: the hour and minute for a run of today, with the day and
 * month for an older one; the tooltip keeps the whole time.
 */
export const shortWhen = (iso: string, now = new Date()) => {
	const at = new Date(iso);
	return at.toDateString() === now.toDateString()
		? at.toLocaleTimeString(undefined, HOUR)
		: at.toLocaleString(undefined, { day: "numeric", month: "short", ...HOUR });
};
