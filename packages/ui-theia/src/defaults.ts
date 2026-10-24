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

/** The context share from which the Team view's bar takes the warning colour: 80% (04 Decisions, ADR-090). */
export const CONTEXT_WARN_SHARE = 0.8;
