// Named defaults for this package; each names the document tab that defines it (CONTRIBUTING.md).

/** A call waits for a reset at most this long, then the run pauses (09 Scheduler, step 3). */
export const QUOTA_WAIT_MAX_MS = 90_000;

/** A sliding month counts the last 30 days (09 Quota pool, windows). */
export const SLIDING_MONTH_DAYS = 30;
