# ADR-181: Verified tool isolation and exact task controls

Status: Accepted
Date: 2026-11-07

## Context

The user approved the two directions in
`../superpowers/specs/2026-11-07-parallel-safety-decisions.md`.
The user explicitly approved this ADR's details and S1-S12 on 2026-11-07
("evet devam etsene").
ADR-174 requires independent worktrees and task-local waits, but neither an
optional cwd nor the run-level last policy event proves either guarantee.
Existing run, engine, policy and tool contracts must remain compatible.

## Decision

Implement P2/P4/P5 in bounded package slices, with these additive versioned ports:

- `tool.isolation@1`: an adapter-owned descriptor inspects an exact capability,
  adapter id, input and cwd. It returns workspace scope or worktree scope with
  the canonical root. Missing, invalid, mismatched or unsupported descriptors
  mean workspace scope. Only a descriptor registered with the tool's adapter id
  and trust may describe it. An implementation's claim requires contract tests.
- Core captures the actual adapter chain it checked and executes only that chain.
  Binding changes or replacement/disposal before dispatch require new resolution,
  never an unchecked fallback. Canonical roots of concurrent writers must not
  overlap. Workspace-scoped actions run exclusively.
- Initially only native fs write/edit operations may claim worktree confinement.
  They refuse absolute escapes, traversal and symbolic-link escapes even if
  policy would otherwise allow an outside write. Shell, Git mutation, mapped
  tools, raw MCP, vault and browser effects remain exclusive. This is not an OS
  sandbox claim. Missing worktree or confinement evidence preserves sequential
  execution.
- Checkpoint allocation is serialized per run, across worktrees and workspace.
  Composition attests the exact checkpoint adapter object whose cwd behavior is
  verified; core captures and rechecks it with the writer. Unknown wrappers keep
  writers exclusive. The core-owned queue survives adapter replacement and drive
  restarts and also covers restore undo checkpoints.
  A writer starts only after its checkpoint and in-flight record are persisted.
  Pause drains writes; cancel signals them but does not detach unknown writes;
  recovery never silently repeats an uncertain write (ADR-177).
- `policy.requests@1` supports `task.control@1`: the security module retains an
  immutable request id and the exact server-owned action identity after a policy
  ask. Display data is masked. A grant names run, agent and request, never supplied
  replacement commands or paths. It matches the original arguments as well as
  action, capability, adapter, path and command. `once` is consumed once;
  `task` lasts only for that agent attempt and never bypasses taint or a deny.
  Legacy `policy.grant@1` stays available for legacy single-run control.
- `task.control@1` lists pending task decisions and answers an exact
  `{ runId, taskId, requestId }`. Supported decisions are policy allow
  (`once` or `task`), approve, revise/answer with feedback, and merge retry.
  Stale attempts, duplicate answers, wrong tasks and ended runs fail closed.
  The pending identity is persisted with the task; secrets and raw policy
  arguments are not. Process-local policy requests/grants expire on restart;
  recovery requires the still-pending tool to ask again after user resume.
- One task waiting for policy, human approval, clarification or merge does not
  pause independent runnable work. Run-wide budget/quota/network/user pauses
  retain their meaning. Coordinator/verify/review/best-of-N steps remain
  serialized, but their human waits do not occupy a worker slot.
- Protocol 30 adds `mete/task.pending` and `mete/task.answer`. Existing messages
  keep their shapes. Legacy run-level allow delegates only when exactly one task
  policy request is pending; ambiguity is refused. No task UI action writes
  `shell.always` or any configuration file.
- New `task.waiting` and `task.wait.resolved` events carry request id and wait
  kind, with existing run/task/agent envelope fields. Their schemas and rows in
  docs/07 precede emission. UI reads authoritative pending data rather than
  inferring an answer target from the newest event.

## Consequences

Safe native file writes can overlap while unknown side effects stay exclusive.
The user can answer the intended task while other tasks continue. Previous APIs
remain intact, and missing support disables the new actions explicitly.
This decision does not approve dependency upgrades, external engines, publishing,
telemetry, real-provider tests or any Phase 6 feature.

## Alternatives Rejected

- Treat every worktree path as isolation: adapters can ignore it.
- Trust the checkpoint flag as a side-effect classification: several tools write
  without that flag.
- Reuse the last run-level policy event: a concurrent task can replace it.
- Grant by displayed masked command: masking can change its identity.
- Add a container requirement: incompatible with the local-development contract.
