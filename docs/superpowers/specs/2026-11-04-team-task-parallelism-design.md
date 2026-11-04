# Team task parallelism design

Status: Proposed for review  
Date: 2026-11-04  
Scope: `@mete/core`, ADR-174 (`docs/adr/README.md`)

## Problem

The accepted design allows up to two dependency-ready tasks in one team run to work side by side. The current engine has one run-level conversation slot (`RunContext.task`, `messages`, `agent`, `turns`, checkpoint index and snapshot), and `run-driver.ts` advances that slot with one loop. `TeamState` already stores each task's conversation, but the live agent and work/checkpoint state are moved into the shared run context when a task is opened. Starting a second task before the first completes would therefore overwrite the first task's active session.

The implementation must provide real concurrent task progress while keeping the run restartable, quota- and budget-bounded, safe for independent writes, and compatible with the existing event and tool contracts.

## Goals

- Run at most two eligible task workers at once, in template order.
- Keep every task's conversation and execution state isolated and persisted in the run snapshot.
- Continue to use the existing shared gateway, quota scheduler, run budget, turn limits, policy checks, tools and event schemas.
- Keep a task waiting for a human independent from other runnable tasks. Pause the run for approval only when no other task can proceed.
- Land approved worktrees one at a time in approval order; do not start a dependent task until its dependencies have landed.
- Pause every worker for run-wide blockers and resume each from its last persisted state.
- Keep best-of-N attempts sequential within their task, and keep non-git/workspace-writing tasks exclusive.

## Non-goals

- No changes to capability IDs, public event schemas, provider adapters or team-template syntax.
- No attempt to run independent tasks in the same workspace checkout.
- No parallel execution of two attempts of one best-of-N task.
- No separate child run per task.
- No UI redesign; existing task/agent events remain the source of the Team panel state.

## Proposed design

### Persisted task session

Extend the internal `TaskEntry` snapshot shape with an optional execution session. The session owns fields currently held by the active `RunContext`: the current attempt's agent reference (provider/model/family/context window), turn count, checkpointed message index, optional file-snapshot reference, and external-content taint flag. The task's existing `messages` remains its conversation. The session is optional so old persisted runs parse with the current defaults and can be resumed.

The run-level `messages`, `agent`, `turns`, checkpoint and snapshot fields remain available for single-agent runs and for team orchestration conversations (clarification, review, judge). A team worker call reads and updates its task session directly; opening another task never swaps or clears another worker's state. When a task's attempt ends, its session is reset or retained according to the existing attempt/revision rules. A revision continues the chosen attempt's own conversation and worktree.

Persist each completed model reply, tool result, checkpoint update and session transition through the existing run snapshot store before scheduling the next worker step. This makes a process restart recover all completed work while the existing recovery path pauses in-flight runs before resuming them.

Each worker carries a stable task/agent identity into `onModel`, `agent.thinking.*`, tool, checkpoint and status events. No worker callback may infer its task or agent from a mutable run-level active seat. The run-level transcript remains the source for coordinator-only clarification, review and judge calls; each worker's transcript stays on its task entry.

### Run coordinator and worker slots

Keep one coordinator loop per run. It chooses the next action from the team state and the set of active worker tasks, then starts eligible task workers up to the configured default `TASKS_IN_FLIGHT = 2` in `packages/core/src/defaults.ts`.

The coordinator selects ready tasks in template order. A task is eligible when all context dependencies are approved and merged, its status is `todo` or `changes_requested`, and a slot is free. Before starting a second writer, it confirms the task can receive its own worktree. If no `vcs.git@2` adapter exists, worktree creation fails, or the workspace cannot create worktrees, a writing task runs alone in the workspace as specified by ADR-174. Non-writing tasks may still run beside a writer.

Workers execute task-local model/tool steps. Model calls use the existing `llm.chat@2` adapter and shared quota scheduler. The run-wide budget remains authoritative: dispatch records a persisted reservation before starting a model call, preventing simultaneous workers from each consuming the last available budget slot. Completion or failure releases the reservation and updates the existing request accounting according to current single-worker semantics. A resume clears stale reservations because process recovery has already stopped every prior worker.

### Isolation of tools and checkpoints

Every worker step derives its `ToolContext` from its task session: task ID, agent ID, worktree `cwd`, taint state and cancellation signal. Tool callbacks and emitted events capture the worker's task/agent identity rather than reading a mutable run-level active task.

Before a task's first write in a step, checkpoint its own worktree (or use the existing file snapshot fallback where supported). Run-level workspace checkpoints remain for sequential merges. Two writers cannot share a checkout. `shell.exec@1`, `fs.*@1`, verify gates, setup commands and screenshots all receive the worker's own worktree context.

### Completion, review, approval and merge order

Submitting a worker persists its report and task status, then releases its worker slot. Internal approver/reviewer conversations run as coordinator work and do not consume a worker slot. A submission needing only system/role review is processed by the coordinator. A submission needing a human is marked waiting; other eligible tasks continue. Human approval/revision requests and task-local `approval_required` decisions must be accepted while the run remains `running`; they update only the named task and wake the coordinator. Existing `approve`, `revise` and `allow` command inputs remain unchanged.

Approved worktrees enter a `TeamState` merge queue in approval order, persisted in the same snapshot update as approval. A legacy snapshot can have at most one outstanding approved worktree because the existing engine merges before starting another task; its queue is reconstructed from that task. The coordinator merges one at a time, records the existing workspace checkpoint, emits the existing merge events, removes the queue entry only after a successful landing, and only then considers newly unblocked dependents. A merge failure follows the current `task.merge.failed` path, retains the worktree and branch, and waits for human approval. A task without a worktree needs no merge.

The run completes only when every task is approved, all approved worktrees have landed, and all required lessons are settled. If all active slots are empty and no task can proceed, existing blocked/waiting behavior applies. The run pauses for `approval` only when a human decision is the remaining work.

### Pause, cancel and resume

`quota`, `network`, `no_model`, `budget`, user pause and cancellation are run-wide. A run-wide pause aborts active model calls, lets already-started tool calls settle as current user-pause behavior requires, persists their completed results, and prevents workers from dispatching a next step before recording the pause. Cancellation aborts both model and tool signals. Resume reconstructs workers from task sessions and schedules them in template order. An approval wait is task-local: other workers may continue; approval/revision while the run is active updates the task and wakes the coordinator without requiring a run-wide resume.

Run-wide model calls and approval/review calls use their existing paths. A task worker may not continue after a run-wide pause token changes. Late replies from aborted/stale worker tokens are discarded, matching the existing run-token guard.

## Internal state and compatibility

- Extend `TaskEntrySchema` and the core `TeamStateSchema` only; persist worker sessions, pending model reservations and the approval-ordered merge queue in the existing XState snapshot. No `@mete/contracts` capability or event schema changes.
- Update the internal persisted snapshot parser in `packages/core/src/infrastructure/run-store.ts` to accept optional worker-session fields and legacy snapshots without them.
- Add `TASKS_IN_FLIGHT` to `packages/core/src/defaults.ts`, linked to docs/08 and ADR-174.
- Do not add a dependency. Keep the existing XState run/task machines and SQLite snapshot persistence.
- Keep the concurrency limit fixed at the documented default for this slice; configuration is not introduced without a documented setting.

## Verification

Core tests must use the existing scripted model adapter; no real provider calls. The acceptance tests cover:

1. Two independent non-writing tasks overlap, with distinct conversations, agents and task IDs, and a dependent task waits until both are approved.
2. The third eligible task waits until a slot frees; starts remain in template order.
3. Two writers use different worktrees; their writes/checkpoints cannot target the same checkout; merges happen serially in approval order, including across restart.
4. A workspace-writing task without a worktree runs alone; non-writing tasks may run alongside a writer.
5. A task waiting for a human does not block another runnable task; the run pauses for approval only after all other work is exhausted.
6. Quota/network/no-model/budget/user pause stops next-step dispatch, waits for in-flight tools according to current semantics, and resumes each task's messages, agent, turn count, taint and checkpoint position without losing or mixing a reply.
7. Cancel, task-local policy approval-required, merge failure/retry, revisions, clarifications, reviews, spawned tasks and best-of-N retain current semantics.
8. Legacy snapshots without task sessions still load and continue under the sequential-compatible state.

Run `pnpm --filter @mete/core test` for focused verification and `pnpm check` before completion. Update docs/08 to remove the sequential-only note and add a changeset for the user-visible scheduling change.

## Implementation slices

This work is larger than one package task of roughly 300 changed lines. Implement as separate reviewed slices, each limited to `@mete/core` plus the necessary docs/changeset:

1. Add task-local persisted execution state and compatibility tests; keep scheduling sequential.
2. Add run coordinator reservations, bounded worker slots and deterministic scheduling for independent non-writing tasks.
3. Add isolated worktree workers, serial merge queue and non-git/workspace-writer exclusion.
4. Complete pause/approval/recovery edge cases, run all checks, update docs and changeset.

Each slice gets tests first and its own `pnpm check`; do not start the next slice until the prior slice passes.

## Open questions

None for the ADR-174 scope. The personal-vault search and Game Studio playability items remain separate tasks; they are not included in this design.
