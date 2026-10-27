import { assign, setup } from "xstate";

// The task state machine of docs/07; state names are the TaskStatus values. Pure, like the run
// machine: the team runner applies events with transition() and checks preconditions the table
// names outside the task (every dependsOn approved, verify gates and guardrail passed).

/** Why a task is blocked (docs/07, Task state machine). */
export type BlockReason =
	| "clarification"
	| "capability_missing"
	| "guardrail"
	| "revision_limit";

/** What a task carries across transitions. */
export type TaskContext = {
	readonly revisionLimit: number;
	readonly revisions: number;
	/** How often the task's pair reviewer returned it (ADR-136); absent before its first return. */
	readonly pairTurns?: number | undefined;
	readonly agentId?: string | undefined;
	/** The task's worktree folder, kept through revisions and blocks (docs/08, Parallel work and merging). */
	readonly worktree?: string | undefined;
	/** The last submission's report. */
	readonly report?: string | undefined;
	/** The approver's feedback or the human's instruction for the next attempt. */
	readonly feedback?: string | undefined;
	readonly blocked?: BlockReason | undefined;
};

/** What happens to a task. */
export type TaskEvent =
	| { type: "START"; agentId: string; worktree?: string }
	| { type: "SUBMIT"; report: string }
	| { type: "BLOCK"; reason: Exclude<BlockReason, "revision_limit"> }
	| { type: "APPROVE" }
	| { type: "REVISE"; feedback: string }
	| { type: "PAIR_REVISE"; feedback: string }
	| { type: "UNBLOCK"; instruction: string };

/** The task machine; its input is the template's revision limit. */
export const taskMachine = setup({
	types: {
		context: {} as TaskContext,
		events: {} as TaskEvent,
		input: {} as { revisionLimit: number },
	},
	guards: {
		withinLimit: ({ context }) =>
			context.revisions + 1 <= context.revisionLimit,
	},
}).createMachine({
	id: "task",
	initial: "todo",
	context: ({ input }) => ({
		revisionLimit: input.revisionLimit,
		revisions: 0,
	}),
	states: {
		todo: {
			on: {
				START: {
					target: "in_progress",
					actions: assign(({ context, event }) => ({
						agentId: event.agentId,
						worktree: event.worktree ?? context.worktree,
					})),
				},
			},
		},
		in_progress: {
			on: {
				SUBMIT: {
					target: "submitted",
					actions: assign({ report: ({ event }) => event.report }),
				},
				BLOCK: {
					target: "blocked",
					actions: assign({ blocked: ({ event }) => event.reason }),
				},
			},
		},
		submitted: {
			on: {
				APPROVE: "approved",
				// A pair reviewer's return does not count toward the revision limit (ADR-136).
				PAIR_REVISE: {
					target: "changes_requested",
					actions: assign(({ context, event }) => ({
						pairTurns: (context.pairTurns ?? 0) + 1,
						feedback: event.feedback,
					})),
				},
				REVISE: [
					{
						guard: "withinLimit",
						target: "changes_requested",
						actions: assign(({ context, event }) => ({
							revisions: context.revisions + 1,
							feedback: event.feedback,
						})),
					},
					{
						target: "blocked",
						actions: assign(({ event }) => ({
							blocked: "revision_limit" as const,
							feedback: event.feedback,
						})),
					},
				],
			},
		},
		changes_requested: {
			on: {
				START: {
					target: "in_progress",
					actions: assign(({ context, event }) => ({
						agentId: event.agentId,
						worktree: event.worktree ?? context.worktree,
					})),
				},
			},
		},
		blocked: {
			on: {
				UNBLOCK: {
					target: "in_progress",
					actions: assign(({ event }) => ({
						blocked: undefined,
						feedback: event.instruction,
					})),
				},
			},
		},
		approved: { type: "final" },
	},
});

/** A snapshot of the task machine. */
export type TaskSnapshot = ReturnType<typeof taskMachine.resolveState>;
