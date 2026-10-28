# 07 Domain model and events

Repository file: `docs/07-domain-model-and-events.md`. Depends on: 02 Glossary, 06 Kernel and modules.

All state lives in typed entities persisted in SQLite, and every change to them is published as an event; the UI, replay and the learning router read only events.

## Entities

```ts
interface Workspace { id: string; path: string; name: string; isGitRepo: boolean;
  sensitivity: "normal" | "sensitive"; createdAt: string }

interface Run { id: string; workspaceId: string; templateId: string | null;   // null = single agent
  goal: string; status: RunStatus; pauseReason?: PauseReason; autonomyLevel: 0 | 1 | 2 | 3;
  budget: { cloudRequests: number; maxHours: number }; snapshot: unknown;     // XState persisted snapshot
  createdAt: string; startedAt?: string; endedAt?: string }

type RunStatus = "queued" | "running" | "paused" | "completed" | "failed" | "cancelled";
type PauseReason = "quota" | "network" | "user" | "approval" | "no_model" | "budget";

interface Agent { id: string; runId: string; roleId: string;
  model: { providerId: string; modelId: string }; requests: number }

interface Task { id: string; runId: string; roleId: string; title: string; description: string;
  acceptance: string[]; expectedArtifact: ArtifactTypeRef; dependsOn: string[];
  status: TaskStatus; revisions: number; assignedAgentId?: string; report?: string }

type TaskStatus = "todo" | "in_progress" | "submitted" | "approved" | "changes_requested" | "blocked";

interface Artifact { id: string; runId: string; taskId: string; type: ArtifactTypeRef;  // "gdd@1"
  path: string; sha256: string; createdBy: string; createdAt: string }

interface Message { id: string; runId: string; from: string; to: string;      // agent id, "human", "system" or "board"
  kind: "handoff" | "clarification" | "answer" | "review" | "report" | "feedback";
  summary: string; bodyRef: string }

interface Approval { id: string; taskId: string; approver: string;           // role id or "human"
  decision: "approve" | "revise"; feedback?: string; at: string }

interface Checkpoint { id: string; runId: string; stepId: string; kind: "git" | "snapshot"; ref: string; createdAt: string }

interface Handoff { id: string; workspaceId: string; runId: string;              // the run that wrote it (tab 08, Run memory)
  state: "open" | "accepted" | "expired"; body: string;                       // Markdown, built without a model
  createdAt: string; acceptedAt?: string; acceptedByRunId?: string }
```

A `Task.id` is a UUID made when the run starts; the template's task id (`write_gdd`) stays in the run snapshot, and events name a task by its `Task.id`. Tasks and approvals have no table of their own: the run snapshot keeps the tasks and who approved the current submission, and the approval history is the `approval.requested` and `approval.resolved` rows in `events` \[D\].

A team task with an `expected_output` keeps each submitted report as its Artifact: the file `.mete/artifacts/<run id>/<template task id>.json` for a guarded report or `.md` otherwise, replaced by a later submission, and its metadata (`id`, `type`, `path` relative to the workspace root, `sha256`, `createdBy` = the task's agent, `createdAt`) in the run snapshot. The first submission publishes `artifact.created`, later ones `artifact.updated` with the same id. A failed write fails the run with code `artifact_failed`; core-engine declares the `fs.write` permission for these files \[D\].

`Message.summary` is the first sentence of the message body, cut to 80 characters. It MUST NOT be produced by an extra model call \[C\].

## Task state machine

| From | To | When |
| --- | --- | --- |
| todo | in\_progress | An agent starts and every task in `dependsOn` is `approved` |
| in\_progress | submitted | All verify gates and the guardrail pass |
| in\_progress | blocked | A clarification stays unanswered, a required capability is missing, or guardrail retries are exhausted |
| submitted | approved | The approver accepts |
| submitted | changes\_requested | The approver asks for a revision and `revisions + 1` is within the revision limit (`revisions` increments) |
| submitted | blocked | The approver asks for a revision and the limit would be exceeded |
| submitted | changes\_requested | The task's pair reviewer asks for a revision (`revisions` does not increment; ADR-136) |
| changes\_requested | in\_progress | The agent resumes with the feedback |
| blocked | in\_progress | The human resolves the block (answer, new instruction, capability installed) |

Default revision limit: 3 \[D\]. `approved` is final for a task. A blocked task records why: `clarification`, `capability_missing`, `guardrail` or `revision_limit`; the human's answer or instruction that resolves it, like an approver's feedback, goes to the next attempt \[D\].

## Run state machine

| From | To | When |
| --- | --- | --- |
| queued | running | The scheduler starts it |
| running | paused | Quota exhausted, network lost, user pause, human approval needed, no model fits, or budget reached |
| paused | running | The pause reason clears (quota reset, network back, user resume, approval given, model found, budget raised) |
| running | completed | Every task is `approved` and final steps finished |
| running | failed | An unrecoverable error (for example invalid template detected at runtime) |
| any but completed | cancelled | The user cancels |

Runs persist their XState snapshot after every transition, so a restart resumes them exactly \[C\]. Before core-engine keeps text it did not write itself, it masks secrets in it through `secrets.mask@1`: each tool result before it joins the conversation, the model's reply text and a model error's message, so the snapshot, `run.completed.summary` and `run.failed.message` hold masked text (ADR-021). The goal is the user's own text and is kept as typed.

When core-engine activates with recovery on (its default; the CLI turns it off for the commands that do not take the run lock), a run still `running` from an earlier process becomes `paused` with reason `user` and publishes `run.paused`; a run still `queued` first starts, publishing `run.started`, and then pauses the same way. A paused run continues only through `resume`, from its last saved step. A row whose snapshot cannot be read is marked `failed` with a warning in the log and publishes no event, and `resume` or `cancel` of it answers `not_found`. The `quota` timer of a paused run lives in the process that paused it \[D\].

## Event envelope

```ts
interface MeteEvent<T extends string = string, P = unknown> {
  id: string; type: T; ts: string; schema: 1;
  workspaceId: string; runId?: string; taskId?: string; agentId?: string;
  source: string;                 // module id that published it
  payload: P;
}
```

Events are append-only rows in the workspace `mete.db`. Default retention: 90 days of events; run summaries forever \[D\]. Payload schemas live in `@mete/contracts` and are validated before publish. `workspaceId` is a UUID kept in `.mete/workspace.yaml`, created when the workspace is first opened; the composition root (`apps/cli`, `apps/desktop`) passes it to the kernel at start.

Storage persists every catalog event by subscribing once per domain (`run.*`, `task.*`, ...) and inserting it synchronously into the `events` table: `seq` integer primary key (replay order), the envelope columns, `payload` as JSON, with indexes on `(run_id, seq)` and `(type, seq)`. It deletes events older than the retention when it activates. Both databases use WAL and a busy timeout of 5 seconds \[D\].

The gateway writes one row per provider call, retries included, into the workspace `model_calls` table: `id`, `ts`, `run_id`, `provider_id`, `model_id`, `tier` (null for a model target), `request` (the masked messages and tools as sent, JSON), `response` (text and tool calls, JSON), `prompt_tokens`, `completion_tokens`, `latency_ms` and `outcome` (the finish reason or the error code), with an index on `(run_id, ts)`. Rows follow the event retention, deleted when the gateway activates \[D\].

core-engine keeps runs in the workspace `runs` table: `id`, `workspace_id`, `template_id` (null for a single agent), `goal`, `status`, `pause_reason`, `autonomy_level`, `budget_cloud_requests`, `budget_max_hours`, `snapshot` (the XState persisted snapshot as JSON; it holds the conversation and, for a team run, the template it started from and its tasks), `created_at`, `started_at` and `ended_at`, with an index on `status`. Agents go into `agents`: `id`, `run_id`, `role_id`, `provider_id`, `model_id` and `requests`, with an index on `run_id`. A run's row is written after every transition and before its event is published. Run rows are kept forever \[D\].

From Phase 2, handoffs go into the workspace `handoffs` table: `id`, `workspace_id`, `run_id`, `state`, `body`, `created_at`, `accepted_at` and `accepted_by_run_id`, with an index on `(state, created_at)`. Accepting is one conditional update from `open`, so exactly one run gets a handoff; rows are kept forever \[D\].

## Event catalog

| Type | Payload | Published by |
| --- | --- | --- |
| `run.created` | templateId, goal | core-engine |
| `run.started` | none | core-engine |
| `run.paused` | reason, resumesAt? | core-engine |
| `run.resumed` | none | core-engine |
| `run.completed` | summary | core-engine |
| `run.failed` | error code, message | core-engine |
| `run.cancelled` | none | core-engine |
| `run.summarized` | messages (how many were replaced), chars (the summary's length) | core-engine |
| `task.created` | title, roleId, dependsOn | core-engine |
| `task.assigned` | agentId | core-engine |
| `task.status.changed` | from, to | core-engine |
| `task.merge.failed` | code (`merge_conflict` or `io`), message, branch, paths (the conflicting files) | core-engine |
| `task.clarification.requested` | toRoleId, question | core-engine |
| `agent.created` | roleId, providerId, modelId, tier? (the role's tier, ADR-077) | core-engine |
| `agent.model.changed` | from, to, reason (such as `user`, `quota`, `failed`, ADR-122) | core-engine |
| `agent.thinking.started` / `agent.thinking.ended` | none; `agent.thinking.ended` has usage? `{ prompt, completion }`, the token counts of the model call it closes, when the call finished (ADR-090) | core-engine |
| `agent.message.sent` | messageId, from, to, kind, summary | core-engine |
| `agent.tool.called` | capability, adapterId | core-engine |
| `agent.tool.progress` | capability, progress, total? (an MCP server's progress step, never its message; at most once a second per call, ADR-067) | mcp-client |
| `agent.tool.completed` | capability, ok, durationMs, error? (the code of a failed call, never its message) | core-engine |
| `artifact.created` / `artifact.updated` | artifactId, type, path | core-engine |
| `verify.completed` | gate, ok, details | core-engine |
| `review.requested` / `review.completed` | reviewerRoleId, decision?, feedback? (the pair reviewer's words with a revise, ADR-136) | core-engine |
| `approval.requested` / `approval.resolved` | approver, decision?, feedback?; the request also carries worktree? (the absolute folder of the task's worktree, when the task has one, ADR-132) and files? (the paths the task changed in that worktree, from git status there at the request: added, modified and renamed, not deleted; left out when vcs.git@2 cannot read them or they are more than 200, ADR-141) | core-engine |
| `quota.consumed` | providerId, unit, amount | quota |
| `quota.exhausted` | providerId, unit, resetsAt | quota |
| `quota.restored` | providerId, unit | quota |
| `checkpoint.created` | kind, ref | core-engine |
| `handoff.created` | handoffId, files? (the paths the handoff lists as changed, ADR-133) | core-engine |
| `handoff.accepted` | handoffId, byRunId | core-engine |
| `rollback.performed` | checkpointId | core-engine |
| `vault.note.saved` | path, noteType | vault |
| `policy.blocked` | action, rule | security |
| `policy.asked` | action, capability, adapterId, rule, command? or path? (masked by `secrets.mask@1`, so it may follow the `run.paused` the ask caused; the ask a `policy.grant@1` grants, ADR-121) | security |
| `module.activated` / `module.deactivated` / `module.crashed` / `module.disabled` | moduleId, reason? | kernel |
| `network.lost` / `network.restored` | none | kernel |

A new event type requires a schema in `@mete/contracts` and a row in this table in the same change.
