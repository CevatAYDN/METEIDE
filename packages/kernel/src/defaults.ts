// Named defaults for this package; each names the document tab that defines it (CONTRIBUTING.md).

/** Consecutive adapter failures that open its circuit (06 Kernel and modules). */
export const CIRCUIT_FAILURE_LIMIT = 5;

/** Time an open circuit waits before it lets a trial call through (06 Kernel and modules). */
export const CIRCUIT_HALF_OPEN_MS = 60_000;

/** Restarts a crashed module may use in the window before it is disabled (06 Kernel and modules). */
export const SUPERVISOR_MAX_RESTARTS = 3;

/** Sliding window for counting restarts (06 Kernel and modules). */
export const SUPERVISOR_WINDOW_MS = 5 * 60_000;

/** Waits before each retry of a file operation that hit a Windows lock (10 Tools, MCP and runtimes). */
export const LOCK_RETRY_DELAYS_MS = [100, 300, 1_000] as const;
