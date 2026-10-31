// Named defaults for this package; each names the document tab that defines it (CONTRIBUTING.md).

/** Requests a task is estimated to need before there is history (09 Models, providers and quota, Scheduler, step 6). */
export const ESTIMATE_PER_TASK = 12;

/** Requests an approval by a role is estimated to need before there is history (09 Models, providers and quota, Scheduler, step 6). */
export const ESTIMATE_PER_APPROVAL = 3;

/** Requests a pair review is estimated to need before there is history (09 Models, providers and quota, Scheduler, step 6). */
export const ESTIMATE_PER_REVIEW = 4;

/** Requests a role answering a task's questions is estimated to need before there is history (09 Models, providers and quota, Scheduler, step 6; ADR-142). */
export const ESTIMATE_PER_CLARIFY = 4;

/** Requests a task's lesson after approval takes: one turn without tools (09 Models, providers and quota, Scheduler, step 6; ADR-145). */
export const ESTIMATE_PER_LESSON = 1;

/** Requests the judge of a best-of-N task's attempts is estimated to need (09 Models, providers and quota, Scheduler, step 6; ADR-162). */
export const ESTIMATE_PER_JUDGE = 1;

/** Characters of each candidate's part the judge of a best-of-N task reads (08 Orchestration and teams, Task execution sequence; ADR-162). */
export const JUDGE_CANDIDATE_CHARS = 4000;

/** Times a judge whose reply holds no verdict is asked again before the first candidate goes on (08 Orchestration and teams, Task execution sequence; ADR-162). */
export const JUDGE_REPAIRS = 1;

/** Model turns an attempt takes before its run pauses for the budget (docs/08, Task execution sequence and Single agent; ADR-126). */
export const MAX_TURNS = 25;

/** Calls of the same tool with the same arguments and the same result before the result gets the repeat line (08 Orchestration and teams, Task execution sequence; ADR-166). */
export const REPEAT_LIMIT = 3;

/** Repairs asked of a reviewer whose verdict is not valid (08 Orchestration and teams, Task execution sequence). */
export const REVIEW_REPAIRS = 2;

/** Characters the start brief may take, its label included (08 Orchestration and teams, Run memory). */
export const BRIEF_MAX_CHARS = 4000;

/** Characters the workspace block may take, its label included, and the top-folder names it lists (08 Orchestration and teams, Agent context assembly; ADR-126). */
export const WORKSPACE_MAX_CHARS = 4000;
export const WORKSPACE_MAX_NAMES = 100;

/** Share of the tier window at which older turns are summarized (08 Orchestration and teams, Agent context assembly). */
export const SUMMARY_AT = 0.7;

/** Newest turns a summary keeps word for word (08 Orchestration and teams, Agent context assembly). */
export const SUMMARY_KEEP_TURNS = 4;

/** Below this confidence the router lets the user choose (08 Orchestration and teams, Router). */
export const ROUTER_MIN_CONFIDENCE = 0.7;

/** The longest model tool name an MCP tool may get; OpenAI and Gemini allow 64 (10 Tools, MCP and runtimes, Integration levels). */
export const MCP_TOOL_NAME_MAX = 64;

/** How long a run paused for the network waits before it tries again (08 Orchestration and teams, Single agent, Pauses). */
export const NETWORK_RETRY_MS = 30_000;

/** Days a run's checkpoints are kept after it ended (12 Autonomy and security, SECURITY.md: Checkpoints and rollback). */
export const CHECKPOINT_KEEP_DAYS = 14;

/** Characters a transcript shows of one tool argument or result before it cuts the rest (ADR-125). */
export const TRANSCRIPT_FIELD_MAX = 4000;

/** Paths an approval request lists of the files a task changed in its worktree; past it the request names none (07 Domain model and events, Events; ADR-141). */
export const APPROVAL_FILES_MAX = 200;
