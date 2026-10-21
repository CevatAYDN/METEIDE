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
	return {
		// Half-open once the delay passes: callers may try again; the next outcome decides.
		isOpen: () =>
			openedAt !== undefined && now() - openedAt < CIRCUIT_HALF_OPEN_MS,
		success: () => {
			failures = 0;
			openedAt = undefined;
		},
		failure: () => {
			failures += 1;
			// A failure after the circuit opened (a half-open trial) reopens it.
			if (openedAt !== undefined || failures >= CIRCUIT_FAILURE_LIMIT)
				openedAt = now();
		},
	};
};
