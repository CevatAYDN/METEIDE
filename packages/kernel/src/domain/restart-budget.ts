import { SUPERVISOR_MAX_RESTARTS, SUPERVISOR_WINDOW_MS } from "../defaults.js";

// Supervisor restart limit from docs/06-kernel-and-modules.md (Module lifecycle).

/** Counts one module's restarts in a sliding window. */
export type RestartBudget = {
	/** Records a restart and returns true, or returns false when the window is full. */
	readonly take: () => boolean;
};

/** Creates an empty budget; `now` is injectable so tests control the clock. */
export const createRestartBudget = (
	now: () => number = Date.now,
): RestartBudget => {
	let restarts: number[] = [];
	return {
		take: () => {
			const t = now();
			restarts = restarts.filter((r) => t - r < SUPERVISOR_WINDOW_MS);
			if (restarts.length >= SUPERVISOR_MAX_RESTARTS) return false;
			restarts.push(t);
			return true;
		},
	};
};
