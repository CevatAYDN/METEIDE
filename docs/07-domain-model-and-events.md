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
```

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
| changes\_requested | in\_progress | The agent resumes with the feedback |
| blocked | in\_progress | The human resolves the block (answer, new instruction, capability installed) |

Default revision limit: 3 \[D\]. `approved` is final for a task.

## Run state machine

| From | To | When |
| --- | --- | --- |
| queued | running | The scheduler starts it |
| running | paused | Quota exhausted, network lost, user pause, human approval needed, no model fits, or budget reached |
| paused | running | The pause reason clears (quota reset, network back, user resume, approval given, model found, budget raised) |
| running | completed | Every task is `approved` and final steps finished |
| running | failed | An unrecoverable error (for example invalid template detected at runtime) |
| any but completed | cancelled | The user cancels |

Runs persist their XState snapshot after every transition, so a restart resumes them exactly \[C\].

When core-engine activates with recovery on (its default; the CLI turns it on only for `mete run`), a run still `running` from an earlier process becomes `paused` with reason `user` and publishes `run.paused`; a paused run continues only through `resume`, from its last saved step. The `quota` timer of a paused run lives in the process that paused it \[D\].

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

core-engine keeps runs in the workspace `runs` table: `id`, `workspace_id`, `template_id` (null for a single agent), `goal`, `status`, `pause_reason`, `autonomy_level`, `budget_cloud_requests`, `budget_max_hours`, `snapshot` (the XState persisted snapshot as JSON; it holds the conversation), `created_at`, `started_at` and `ended_at`, with an index on `status`. Agents go into `agents`: `id`, `run_id`, `role_id`, `provider_id`, `model_id` and `requests`, with an index on `run_id`. A run's row is written after every transition and before its event is published. Run rows are kept forever \[D\].

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
| `task.created` | title, roleId, dependsOn | core-engine |
| `task.assigned` | agentId | core-engine |
| `task.status.changed` | from, to | core-engine |
| `task.clarification.requested` | toRoleId, question | core-engine |
| `agent.created` | roleId, providerId, modelId | core-engine |
| `agent.model.changed` | from, to, reason | core-engine |
| `agent.thinking.started` / `agent.thinking.ended` | none | core-engine |
| `agent.message.sent` | messageId, from, to, kind, summary | core-engine |
| `agent.tool.called` | capability, adapterId | core-engine |
| `agent.tool.completed` | capability, ok, durationMs | core-engine |
| `artifact.created` / `artifact.updated` | artifactId, type, path | core-engine |
| `verify.completed` | gate, ok, details | core-engine |
| `review.requested` / `review.completed` | reviewerRoleId, decision? | core-engine |
| `approval.requested` / `approval.resolved` | approver, decision?, feedback? | core-engine |
| `quota.consumed` | providerId, unit, amount | quota |
| `quota.exhausted` | providerId, unit, resetsAt | quota |
| `quota.restored` | providerId, unit | quota |
| `checkpoint.created` | kind, ref | core-engine |
| `rollback.performed` | checkpointId | core-engine |
| `vault.note.saved` | path, noteType | vault |
| `policy.blocked` | action, rule | security |
| `module.activated` / `module.deactivated` / `module.crashed` / `module.disabled` | moduleId, reason? | kernel |
| `network.lost` / `network.restored` | none | kernel |

A new event type requires a schema in `@mete/contracts` and a row in this table in the same change.
