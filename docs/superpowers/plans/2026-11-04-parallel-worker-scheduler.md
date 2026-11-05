# Parallel team worker scheduler implementation plan

Status: Awaiting approval  
Date: 2026-11-04  
Design: `docs/superpowers/specs/2026-11-04-team-task-parallelism-design.md`

## Scope

Implement the scheduler slice of ADR-174 inside `@mete/core`. The first slice, persisted task-session schema and transition rules, is complete in commit `85fb8c8`. The existing driver still executes one mutable run conversation at a time; it cannot safely launch a second task by calling `drive` twice, because both workers would mutate the same `Live.snapshot`, model controller, agent identity, and run-level conversation.

This slice must make up to two dependency-ready, non-writing task workers progress concurrently while retaining one persisted run row and the existing run-wide budget, quota, pause, cancellation, and event contracts. Worktree writers and task-local approvals remain for later slices.

## Constraints

- One package/concern per change; keep each implementation slice at roughly 300 changed lines or fewer.
- Tests use scripted adapters only; no real providers.
- Do not change `@mete/contracts`, capability IDs, events, or team-template syntax.
- Keep `TASKS_IN_FLIGHT = 2` as the documented core default.
- Preserve existing sequential team behavior for writing tasks in this scheduler slice.

## Steps

1. **Worker-local step context (test first).** Add focused domain/application tests proving two task sessions can hold separate messages, agent, turn count, taint, and checkpoint state while the run context retains shared request/budget accounting. Introduce the smallest worker-state adapter needed to run one task step without swapping the run-level task/transcript. Keep current coordinator conversations (clarification/review/judge) sequential.
2. **Bounded non-writing scheduler (test first).** Add `TASKS_IN_FLIGHT` to core defaults. Select dependency-ready non-writing tasks in template order; launch only available slots. Verify with a gated fake model that two task calls are simultaneously pending, each request receives its own transcript and role, a third task waits, and dependencies do not start before approval.
3. **Atomic shared budget accounting (test first).** Reserve a run request before dispatching each worker model call, persist the reservation with the run snapshot, and settle it exactly once on replied/error/missing/abort paths. Test the final-budget race with two workers and recovery from stale reservations.
4. **Persist worker progress and stop behavior (test first).** Save each completed reply/tool result to its owning task session before scheduling another step. A run-wide pause/cancel invalidates every worker token; late replies are ignored. Resume rebuilds workers from persisted sessions in template order. Keep the existing tool path sequential until task-scoped tool context is implemented in the worktree slice.
5. **Compatibility and gate.** Exercise legacy snapshots without sessions, existing single-agent tests, team clarification/review/best-of-N behavior, and run `pnpm --filter @mete/core test` plus `pnpm check`. Update this plan with any discovered behavior that the accepted design does not specify; stop instead of inventing it.

## Exit criteria

- Two independent non-writing tasks demonstrably overlap in a deterministic test.
- Worker transcripts, agent IDs, turns and persisted session data never cross task boundaries.
- A dependency waits; a third ready task waits for a slot; dispatch order is template order.
- Concurrent requests cannot exceed the run budget; all model calls still go through existing quota scheduling.
- Pause/cancel and restart cannot apply a stale result to another worker or task.
- `pnpm check` passes; all unrelated working-tree changes remain untouched.

## Known design decision to validate against implementation

The accepted design requires a reservation before model dispatch but says budget accounting remains at the current cloud-request accounting point. The implementation must resolve this internally with a persisted `reservedRequests` count (or equivalent), so committed requests and in-flight reservations together cannot exceed the budget. A reservation is released if dispatch returns `missing` or fails before a provider request is made; any ambiguous transport failure follows current `RunContext.requests` semantics. If current gateway/core behavior cannot distinguish these outcomes reliably, stop and ask before choosing new billing semantics.
