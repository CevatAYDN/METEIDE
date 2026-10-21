import { CIRCUIT_FAILURE_LIMIT, CIRCUIT_HALF_OPEN_MS } from "../defaults.js";
import type { Circuit } from "./capability-registry.js";

// Adapter circuit breaker from docs/06-kernel-and-modules.md (Capability resolution), ADR-037.

/** A circuit the owning module feeds with the outcome of every adapter call. */
export type CircuitBreaker = Circuit & {
	readonly success: () => void;
	readonly failure: () => void;
};

/** Creates a closed circuit; `now` is injectable so tests control the clock. */
export const createCircuitBreaker = (
	now: () => number = Date.now,
): CircuitBreaker => {
	let failures = 0;
	let openedAt: number | undefined;
	// Half-open once the delay passes: callers may try again; the next outcome decides.
	const isOpen = () =>
		openedAt !== undefined && now() - openedAt < CIRCUIT_HALF_OPEN_MS;
	return {
		isOpen,
		success: () => {
			failures = 0;
			openedAt = undefined;
		},
		failure: () => {
			failures += 1;
			// Closed: open at the limit. Half-open: the trial failed, reopen. Fully open: keep the delay.
			const halfOpen = openedAt !== undefined && !isOpen();
			if (
				halfOpen ||
				(openedAt === undefined && failures >= CIRCUIT_FAILURE_LIMIT)
			)
				openedAt = now();
		},
	};
};
