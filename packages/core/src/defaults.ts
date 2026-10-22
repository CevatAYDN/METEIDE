// Named defaults for this package; each names the document tab that defines it (CONTRIBUTING.md).

/** Model turns a single-agent run may take (docs/08, Task execution sequence and Single agent). */
export const MAX_TURNS = 25;

/** Repairs asked of a reviewer whose verdict is not valid (08 Orchestration and teams, Task execution sequence). */
export const REVIEW_REPAIRS = 2;

/** Characters the start brief may take, its label included (08 Orchestration and teams, Run memory). */
export const BRIEF_MAX_CHARS = 4000;

/** Share of the tier window at which older turns are summarized (08 Orchestration and teams, Agent context assembly). */
export const SUMMARY_AT = 0.7;

/** Newest turns a summary keeps word for word (08 Orchestration and teams, Agent context assembly). */
export const SUMMARY_KEEP_TURNS = 4;
