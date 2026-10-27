import { nls } from "@theia/core/lib/common/nls";

// The panels' times (ADR-092): absolute, never a ticking clock, so a test and a screenshot read the
// same. The one exception is how long a model call has been running (ADR-125), which counts up.

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

/** How long since `since`, as a thinking row counts it: "42 s", or "2 min 5 s" from a minute on. */
export const elapsedText = (since: string, now = Date.now()) => {
	const s = Math.max(0, Math.floor((now - Date.parse(since)) / 1000));
	return s < 60
		? nls.localize("mete/time/seconds", "{0} s", s)
		: nls.localize(
				"mete/time/minutes",
				"{0} min {1} s",
				Math.floor(s / 60),
				s % 60,
			);
};
