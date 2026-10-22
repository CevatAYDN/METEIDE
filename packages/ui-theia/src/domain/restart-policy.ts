/** Counts restarts in a sliding window; `allow` records one only when it says yes. */
export type RestartPolicy = { readonly allow: (now: number) => boolean };

/** At most `max` restarts within any `windowMs` (ARCHITECTURE.md, Failure handling). */
export const createRestartPolicy = (
	max: number,
	windowMs: number,
): RestartPolicy => {
	let stamps: number[] = [];
	return {
		allow: (now) => {
			stamps = stamps.filter((t) => now - t < windowMs);
			if (stamps.length >= max) return false;
			stamps.push(now);
			return true;
		},
	};
};
