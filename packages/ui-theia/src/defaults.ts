// Named defaults for this package; each names the document tab that defines it (CONTRIBUTING.md).

/**
 * Restarts of the daemon before the desktop stops starting it: the kernel supervisor's limits,
 * reused for the daemon (03 Architecture, Failure handling).
 */
export const DAEMON_MAX_RESTARTS = 3;

/** The window those restarts count in: 5 minutes (03 Architecture, Failure handling). */
export const DAEMON_RESTART_WINDOW_MS = 5 * 60 * 1000;

/** The last lines of the daemon's stderr kept to say why it stopped: 5 (03 Architecture, Failure handling). */
export const STDERR_TAIL_LINES = 5;

/** Events the Studio's accessible list shows, newest last (19 Studio view prototype, Events panel). */
export const STUDIO_RECENT_EVENTS = 7;

/** Events the Team view's Activity feed keeps for the shown run, the oldest dropped first: 200 (04 Decisions, ADR-092). */
export const FEED_EVENTS = 200;

/** The context share from which the Team view's bar takes the warning colour: 80% (04 Decisions, ADR-090). */
export const CONTEXT_WARN_SHARE = 0.8;

/** Lines of one file's diff the Changes panel draws, the rest left out: 500 (04 Decisions, ADR-100). */
export const DIFF_LINES = 500;

/** How long the Team panel waits after a step event before it asks for the transcript again: 500 ms (04 Decisions, ADR-125). */
export const TRANSCRIPT_REFETCH_MS = 500;

/** How often a thinking agent's seconds count up: each second (04 Decisions, ADR-125). */
export const THINKING_TICK_MS = 1000;
