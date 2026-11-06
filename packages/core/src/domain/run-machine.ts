import type { ChatMessage, RunPrefer } from "@mete/contracts";
import { assign, setup } from "xstate";
import { MAX_TURNS } from "../defaults.js";
import { canReserve, reservedFor } from "./request-reservations.js";
import type { RunContext, RunEvent } from "./run-types.js";
import {
	resumeWorkers,
	switchContext,
	taskContext,
	workerProgress,
} from "./task-worker.js";

export type { AgentRef, RunContext, RunEvent } from "./run-types.js";

// The run state machine of docs/07 for a single-agent run (docs/08, Single agent). Pure:
// callers apply events with xstate's transition() and persist the snapshot after each one.

/** The user message that asks for more after a reply cut at the token limit. */
export const CONTINUE = "Continue where your last reply was cut off.";

/** Running time up to `at`. */
export const activeTime = (c: RunContext, at: number) =>
	c.activeMs + (c.since === undefined ? 0 : at - c.since);

const stop = (c: RunContext, at: number) => ({
	activeMs: activeTime(c, at),
	since: undefined,
	reservations: [],
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

const resumed = (context: RunContext, at: number) => {
	const next = resumeWorkers(context);
	return {
		...next,
		since: at,
		pause: undefined,
		reservations: [],
		turns: next.turns >= MAX_TURNS ? 0 : next.turns,
	};
};

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
			workspace?: string | undefined;
			prefer?: RunPrefer | undefined;
			tainted?: boolean | undefined;
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
		...(input.workspace ? { workspace: input.workspace } : {}),
		...(input.prefer ? { prefer: input.prefer } : {}),
		...(input.tainted ? { tainted: true } : {}),
		preferRevision: 0,
		turns: 0,
		requests: 0,
		reservations: [],
		activeMs: 0,
		checkpointed: -1,
	}),
	// A tool call or checkpoint that finishes after a user pause is kept (docs/08), so these
	// apply in paused too; a done machine ignores every event.
	on: {
		MODEL: { actions: assign({ agent: ({ event }) => event.agent }) },
		TEAM: { actions: assign({ team: ({ event }) => event.team }) },
		ACTIVATE: {
			actions: assign(
				({ context, event }) => taskContext(context, event.task) ?? {},
			),
		},
		RELEASE: {
			guard: ({ context, event }) =>
				context.reservations?.some((r) => r.id === event.id) === true,
			actions: assign(({ context, event }) => ({
				reservations: context.reservations?.filter((r) => r.id !== event.id),
			})),
		},
		WORKER: {
			guard: ({ context, event }) =>
				!event.reservation ||
				reservedFor(context, event.reservation, event.task),
			actions: assign(({ context, event }) => workerProgress(context, event)),
		},
		PREFER: {
			actions: assign(({ context, event }) => ({
				prefer: event.prefer,
				preferRevision: (context.preferRevision ?? 0) + 1,
			})),
		},
		// A summary is a cloud request but no agent turn; checkpoint indexes no longer hold.
		SUMMARIZED: {
			actions: assign(({ context, event }) => ({
				messages: event.messages,
				requests: context.requests + 1,
				checkpointed: -1,
				snapshot: undefined,
			})),
		},
		// Cut results keep every message where it was, so checkpoint indexes hold (ADR-170).
		CUT: {
			actions: assign(({ event }) => ({ messages: event.messages })),
		},
		// The lesson turn after an approval (docs/08, step 8): a cloud request when a reply came, no turn.
		LEARNED: {
			actions: assign(({ context, event }) => ({
				team: event.team,
				requests: context.requests + (event.replied ? 1 : 0),
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
		// A new attempt: its own turns, checkpoints and agent (docs/08, Task execution sequence); an
		// attempt that goes on after its questions or a lifted block keeps its turns and taint.
		SWITCH: {
			actions: assign(({ event }) => switchContext(event)),
		},
		// A review's or a judge's verdict is recorded with the conversation it ends (ADR-162).
		REVIEWED: {
			actions: assign(({ event }) => ({
				team: event.team,
				review: undefined,
				judge: undefined,
			})),
		},
		// A writing call is recorded before it runs, so a crash in it is seen on recovery (ADR-177).
		TOOL_STARTED: {
			actions: assign({ inFlight: ({ event }) => event.callId }),
		},
		TOOL_DONE: {
			actions: assign({
				messages: ({ context, event }) => [...context.messages, event.message],
				tainted: ({ context, event }) =>
					context.tainted || event.external === true,
				inFlight: undefined,
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
				RESERVE: {
					guard: ({ context, event }) =>
						canReserve(context, event.reservation, event.limit),
					actions: assign(({ context, event }) => ({
						reservations: [...(context.reservations ?? []), event.reservation],
					})),
				},
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
					// A resume after the turn limit gives the attempt MAX_TURNS more (ADR-126).
					actions: assign(({ context, event }) => resumed(context, event.at)),
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
