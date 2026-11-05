// Named defaults for this package; each names the document tab that defines it (CONTRIBUTING.md).

/** Days events stay in the workspace database (07 Domain model and events). */
export const EVENT_RETENTION_DAYS = 90;

/** How long a statement waits for another connection's lock (07 Domain model and events). */
export const BUSY_TIMEOUT_MS = 5_000;

/** Largest payload JSON stored whole; a bigger one is stored cut (07 Domain model and events, Persisted events). */
export const EVENT_PAYLOAD_MAX_BYTES = 65_536;
