import type {
	ChatChunk,
	ChatMessage,
	PauseReasonSchema,
} from "@mete/contracts";
import { assign, setup } from "xstate";
import type { z } from "zod";

// The run state machine of docs/07 for a single-agent run (docs/08, Single agent). Pure:
// callers apply events with xstate's transition() and persist the snapshot after each one.

type PauseReason = z.infer<typeof PauseReasonSchema>;
type Finish = Extract<ChatChunk, { type: "finish" }>["reason"];
type Assistant = Extract<ChatMessage, { role: "assistant" }>;
type ToolMessage = Extract<ChatMessage, { role: "tool" }>;

/** The model behind the run's one agent. */
export type AgentRef = {
	readonly id: string;
	readonly providerId: string;
	readonly modelId: string;
};

/** Everything a run needs to continue after a restart; times are epoch milliseconds. */
export type RunContext = {
	readonly goal: string;
	readonly priority: 0 | 1 | 2;
	readonly messages: readonly ChatMessage[];
	/** Model replies so far; each one is also a cloud request of the budget. */
	readonly turns: number;
	/** Running time before `since`. */
	readonly activeMs: number;
	/** When the current running stretch began. */
	readonly since?: number | undefined;
	/** Index of the last step (assistant message) that has its checkpoint. */
	readonly checkpointed: number;
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
};

/** What happens to a run. */
export type RunEvent =
	| { type: "START"; at: number }
	| { type: "REPLIED"; message: Assistant; finish: Finish }
	| { type: "TOOL_DONE"; message: ToolMessage }
	| { type: "MODEL"; agent: AgentRef }
	| { type: "CHECKPOINTED"; step: number }
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
		},
	},
}).createMachine({
	id: "run",
	initial: "queued",
	context: ({ input }) => ({
		goal: input.goal,
		priority: input.priority,
		messages: input.messages,
		turns: 0,
		activeMs: 0,
		checkpointed: -1,
	}),
	// A tool call or checkpoint that finishes after a user pause is kept (docs/08), so these
	// apply in paused too; a done machine ignores every event.
	on: {
		MODEL: { actions: assign({ agent: ({ event }) => event.agent }) },
		TOOL_DONE: {
			actions: assign({
				messages: ({ context, event }) => [...context.messages, event.message],
			}),
		},
		CHECKPOINTED: {
			actions: assign({ checkpointed: ({ event }) => event.step }),
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
