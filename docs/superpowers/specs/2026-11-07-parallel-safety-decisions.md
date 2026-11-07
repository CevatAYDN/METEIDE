# Parallel writer and task approval decisions

Status: Directions approved by the user on 2026-11-07 ("devam et"), following
the explicit approval question. ADR-181 details and its S1-S12 plan were then
explicitly approved ("evet devam etsene") under AGENTS.md's task-size rule.
Direction approval is not evidence that the features are implemented.
Date: 2026-11-07
Context: approved P1-P5 continuation, ADR-174.

## Why P2 Cannot Be Enabled Yet

A distinct worktree does not prove that the selected adapter uses it.
`ToolContext.cwd` is optional; the module rules explicitly let adapters ignore it.
MCP and CLI mappings currently resolve `workspace.path` from the main workspace.
Native adapters provide no existing registry feature that distinguishes their
worktree confinement from these mappings.

Source:

- `packages/mcp/src/application/mapped.ts`
- `packages/mcp/src/application/cli-mapped.ts`
- `packages/tools/src/module.ts`
- `docs/06-kernel-and-modules.md`, ToolContext

Admitting all writers based on a unique directory could write the same main
workspace in parallel while checkpointing different directories. Identifying
native adapters by hardcoded module names in core would violate AGENTS.md.
Therefore writers remain sequential.

## Recommended Isolation Contract

Add a versioned adapter-isolation descriptor, provisionally `tool.isolation@1`.
It identifies the capability and exact adapter and reports either workspace-scoped
or worktree-confined execution. Absence, invalid data or unsupported operations
means workspace-scoped, never safe to parallelize.

Acceptance rules:

1. Contract tests prove that a worktree-confined adapter resolves every write from
   the supplied cwd and refuses paths outside its permitted root.
2. Core checks every adapter that the call's fallback chain may reach, not only
   the first. Execution must use the checked adapter set; a changed binding cannot
   silently introduce an unchecked fallback.
3. Current mappings remain workspace-scoped until their input rendering, runtime
   and asset handling implement the same contract.
4. Checkpoint ref allocation is serialized per run. The real Git adapter uses a
   shared run ref counter, so separate cwd values do not remove its allocation race.
5. Only after a checkpoint is persisted can a writer execute concurrently.
   Pause drains known writes; cancel/recovery retains uncertain-write semantics.

Alternative: keep every write serialized indefinitely. This is safe and is the
current behavior, but it does not fulfill parallel writing.

## Why P4 Needs an Approval Identity

The existing daemon `mete/run.allow` accepts only `{ runId, scope }`.
`apps/cli/src/application/allow.ts` chooses the newest `policy.asked` event and
requires the whole run to be paused for approval. Two independent tasks can ask
different questions, so a run ID alone cannot express which question the human
approved while the other task continues.

## Recommended Task Control Contract

Add a versioned task-control port, provisionally `task.control@1`, with an explicit
pending-question read and answer operation. The answer identifies the run, task
and immutable pending ask, not just the run's most recent event.

Acceptance rules:

1. A response for a stale attempt, another task or an already answered ask fails
   closed. All identifiers and inputs are parsed at the boundary.
2. The control resolves the exact pending action from server-owned state; clients
   cannot supply replacement commands, paths or permissions.
3. One task's wait does not stop independent ready tasks. The run is paused for
   approval only when no runnable task remains.
4. Existing `mete/run.allow` and `team.engine@2` callers stay compatible. New daemon
   messages require a protocol bump; any new events need contracts schemas and
   docs/07 rows before implementation.
5. The UI shows and answers each pending task independently. It never grants a
   different request because another event arrived after rendering.
6. Tests cover two simultaneous asks, out-of-order answers, late masking/events,
   cancel/resume, recovery, stale UI and concurrent human decisions.

Alternative: serialize all policy questions and show only one pending question.
This keeps the old port but does not deliver the requested independent-task UX.

## Approval Scope

The user approved these two contract directions before P2/P4/P5 continue.
This approval does not authorize external engine adapters, telemetry, real
provider test calls, dependency upgrades, publishing or Phase 6 work.
