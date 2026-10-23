// Named defaults for this package; each names the document tab that defines it (CONTRIBUTING.md).

/**
 * Restarts of the daemon before the desktop stops starting it: the kernel supervisor's limits,
 * reused for the daemon (03 Architecture, Failure handling).
 */
export const DAEMON_MAX_RESTARTS = 3;

/** The window those restarts count in: 5 minutes (03 Architecture, Failure handling). */
export const DAEMON_RESTART_WINDOW_MS = 5 * 60 * 1000;

// shortcut: no document fixes this number; five lines hold the usual reasons a daemon still stops
// (a run lock held by another command, an invalid configuration), and it moves when a real one
// needs more.
/** The last lines of the daemon's stderr kept to say why it stopped. */
export const STDERR_TAIL_LINES = 5;
