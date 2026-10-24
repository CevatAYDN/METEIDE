import type {
	ChatChunk,
	ChatMessage,
	PauseReasonSchema,
} from "@mete/contracts";
import { assign, setup } from "xstate";
import type { z } from "zod";
import type { TeamState } from "./team.js";

// The run state machine of docs/07 for a single-agent run (docs/08, Single agent). Pure:
// callers apply events with xstate's transition() and persist the snapshot after each one.

type PauseReason = z.infer<typeof PauseReasonSchema>;
type Finish = Extract<ChatChunk, { type: "finish" }>["reason"];
type Assistant = Extract<ChatMessage, { role: "assistant" }>;
type ToolMessage = Extract<ChatMessage, { role: "tool" }>;

/** The model behind the run's one agent. */
export type AgentRef = {
	readonly id: string;
	/** The team role it plays; a single agent is role assistant. */
	readonly roleId?: string | undefined;
	readonly providerId: string;
	readonly modelId: string;
};

/** Everything a run needs to continue after a restart; times are epoch milliseconds. */
export type RunContext = {
	readonly goal: string;
	readonly priority: 0 | 1 | 2;
	readonly messages: readonly ChatMessage[];
	/** Model replies of the current attempt; MAX_TURNS limits them. */
	readonly turns: number;
	/** Model replies of the whole run, the cloud requests of the budget. */
	readonly requests: number;
	/** Running time before `since`. */
	readonly activeMs: number;
	/** When the current running stretch began. */
	readonly since?: number | undefined;
	/** Index of the last step (assistant message) that has its checkpoint. */
	readonly checkpointed: number;
	/** The file snapshot of that step, in a folder that is not a git repository (ADR-080). */
	readonly snapshot?: string | undefined;
	readonly agent?: AgentRef | undefined;
	readonly pause?:
		| { readonly reason: PauseReason; readonly resumesAt?: string | undefined }
		| undefined;
	readonly summary?: string | undefined;
	readonly error?:
		| { readonly code: string; readonly message: string }
		| undefined;
	readonly startedAt?: number | undefined;
	readonly endedAt?: number | undefined;
	/** A team run's tasks and template (docs/08); absent for a single agent. */
	readonly team?: TeamState | undefined;
	/** The team task whose conversation is in `messages`. */
	readonly task?: string | undefined;
	/** The approver role reviewing `task` in this conversation (docs/08, step 7). */
	readonly review?: string | undefined;
	/** The start brief every conversation of the run opens with (docs/08, Run memory). */
	readonly brief?: string | undefined;
	/** External content joined this attempt, so its tool calls are tainted (SECURITY.md). */
	readonly tainted?: boolean | undefined;
};

/** What happens to a run. */
export type RunEvent =
	| { type: "START"; at: number }
	| { type: "REPLIED"; message: Assistant; finish: Finish }
	| { type: "TOOL_DONE"; message: ToolMessage; external?: boolean }
	| { type: "MODEL"; agent: AgentRef }
	| { type: "TEAM"; team: TeamState }
	| { type: "SUMMARIZED"; messages: readonly ChatMessage[] }
	| { type: "REPAIR"; team: TeamState; content: string }
	| {
			type: "SWITCH";
			task: string;
			team: TeamState;
			messages: readonly ChatMessage[];
			review?: string;
	  }
	| { type: "REVIEWED"; team: TeamState }
	| { type: "CHECKPOINTED"; step: number; snapshot?: string }
	| { type: "PAUSE"; at: number; reason: PauseReason; resumesAt?: string }
	| { type: "RESUME"; at: number }
	| { type: "COMPLETE"; at: number; summary: string }
	| { type: "FAIL"; at: number; code: string; message: string }
	| { type: "CANCEL"; at: number };

/** The user message that asks for more after a reply cut at the token limit. */
export const CONTINUE = "Continue where your last reply was cut off.";

/** Running time up to `at`. */
export const activeTime = (c: RunContext, at: number) =>
	c.activeMs + (c.since === undefined ? 0 : at - c.since);

const stop = (c: RunContext, at: number) => ({
	activeMs: activeTime(c, at),
	since: undefined,
});

const reply = (c: RunContext, e: Extract<RunEvent, { type: "REPLIED" }>) => {
	const cut = e.finish === "length" && !e.message.toolCalls?.length;
	const more: ChatMessage[] = cut ? [{ role: "user", content: CONTINUE }] : [];
	return {
		messages: [...c.messages, e.message, ...more],
		turns: c.turns + 1,
		requests: c.requests + 1,
	};
};

const ended = (c: RunContext, at: number) => ({ ...stop(c, at), endedAt: at });

/** The run machine; its input is a new run's goal, priority and opening messages. */
export const runMachine = setup({
	types: {
		context: {} as RunContext,
		events: {} as RunEvent,
		input: {} as {
			goal: string;
			priority: 0 | 1 | 2;
			messages: readonly ChatMessage[];
			brief?: string | undefined;
		},
	},
}).createMachine({
	id: "run",
	initial: "queued",
	context: ({ input }) => ({
		goal: input.goal,
		priority: input.priority,
		messages: input.messages,
		...(input.brief ? { brief: input.brief } : {}),
		turns: 0,
		requests: 0,
		activeMs: 0,
		checkpointed: -1,
	}),
	// A tool call or checkpoint that finishes after a user pause is kept (docs/08), so these
	// apply in paused too; a done machine ignores every event.
	on: {
		MODEL: { actions: assign({ agent: ({ event }) => event.agent }) },
		TEAM: { actions: assign({ team: ({ event }) => event.team }) },
		// A summary is a cloud request but no agent turn; checkpoint indexes no longer hold.
		SUMMARIZED: {
			actions: assign(({ context, event }) => ({
				messages: event.messages,
				requests: context.requests + 1,
				checkpointed: -1,
				snapshot: undefined,
			})),
		},
		// A guardrail repair stays in the attempt: one more user message, turns keep counting.
		REPAIR: {
			actions: assign(({ context, event }) => ({
				team: event.team,
				messages: [
					...context.messages,
					{ role: "user" as const, content: event.content },
				],
			})),
		},
		// A new attempt: its own turns, checkpoints and agent (docs/08, Task execution sequence).
		SWITCH: {
			actions: assign(({ event }) => ({
				task: event.task,
				team: event.team,
				messages: event.messages,
				turns: 0,
				checkpointed: -1,
				snapshot: undefined,
				agent: undefined,
				review: event.review,
				tainted: false,
			})),
		},
		REVIEWED: {
			actions: assign(({ event }) => ({ team: event.team, review: undefined })),
		},
		TOOL_DONE: {
			actions: assign({
				messages: ({ context, event }) => [...context.messages, event.message],
				tainted: ({ context, event }) =>
					context.tainted || event.external === true,
			}),
		},
		CHECKPOINTED: {
			actions: assign({
				checkpointed: ({ event }) => event.step,
				snapshot: ({ event }) => event.snapshot,
			}),
		},
	},
	states: {
		queued: {
			on: {
				START: {
					target: "running",
					actions: assign(({ event }) => ({
						since: event.at,
						startedAt: event.at,
					})),
				},
				CANCEL: "#run.cancelled",
			},
		},
		running: {
			on: {
				REPLIED: {
					actions: assign(({ context, event }) => reply(context, event)),
				},
				PAUSE: {
					target: "paused",
					actions: assign(({ context, event }) => ({
						...stop(context, event.at),
						pause: {
							reason: event.reason,
							...(event.resumesAt ? { resumesAt: event.resumesAt } : {}),
						},
					})),
				},
				COMPLETE: {
					target: "completed",
					actions: assign(({ context, event }) => ({
						...ended(context, event.at),
						summary: event.summary,
					})),
				},
				FAIL: {
					target: "failed",
					actions: assign(({ context, event }) => ({
						...ended(context, event.at),
						error: { code: event.code, message: event.message },
					})),
				},
				CANCEL: "#run.cancelled",
			},
		},
		paused: {
			on: {
				RESUME: {
					target: "running",
					actions: assign(({ event }) => ({
						since: event.at,
						pause: undefined,
					})),
				},
				CANCEL: "#run.cancelled",
			},
		},
		completed: { type: "final" },
		// docs/07: any run but a completed one can be cancelled, a failed one too.
		failed: { on: { CANCEL: "#run.cancelled" } },
		cancelled: {
			type: "final",
			entry: assign(({ context, event }) =>
				event.type === "CANCEL" && context.endedAt === undefined
					? ended(context, event.at)
					: {},
			),
		},
	},
});

/** A snapshot of the run machine. */
export type RunSnapshot = ReturnType<typeof runMachine.resolveState>;
