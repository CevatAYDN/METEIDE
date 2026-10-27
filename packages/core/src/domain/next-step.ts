import { type ChatMessage, isWrite, type ToolCall } from "@mete/contracts";
import { MAX_TURNS } from "../defaults.js";
import { activeTime, type RunContext } from "./run-machine.js";

// What a running single-agent run does next (docs/08, Single agent), read from its context alone,
// so a resumed run picks up exactly where it stopped.

/** The run's budget (SECURITY.md, Policy file). */
export type Budget = {
	readonly cloudRequests: number;
	readonly maxHours: number;
};

/** The next thing to do; `step` is the index of the assistant message that asked for a tool. */
export type NextStep =
	| { readonly kind: "model" }
	| {
			readonly kind: "tool";
			readonly call: ToolCall;
			readonly step: number;
			readonly checkpoint: boolean;
	  }
	| { readonly kind: "complete"; readonly summary: string }
	| { readonly kind: "pause"; readonly reason: "budget" };

const lastAssistant = (messages: readonly ChatMessage[]) =>
	messages.findLastIndex((m) => m.role === "assistant");

const pendingCall = (messages: readonly ChatMessage[], step: number) => {
	const asked = messages[step];
	if (asked?.role !== "assistant") return undefined;
	const done = new Set(
		messages
			.slice(step + 1)
			.flatMap((m) => (m.role === "tool" ? [m.toolCallId] : [])),
	);
	return asked.toolCalls?.find((c) => !done.has(c.id));
};

const HOUR_MS = 3_600_000;

// The turns of an attempt are part of the budget: at the limit the run pauses, and a resume
// gives it MAX_TURNS more (ADR-126).
const modelOrLimit = (c: RunContext, budget: Budget, at: number): NextStep => {
	if (
		c.turns >= MAX_TURNS ||
		c.requests >= budget.cloudRequests ||
		activeTime(c, at) >= budget.maxHours * HOUR_MS
	)
		return { kind: "pause", reason: "budget" };
	return { kind: "model" };
};

/** Decides the next step of a running run at time `at`. */
export const nextStep = (
	c: RunContext,
	budget: Budget,
	at: number,
): NextStep => {
	const step = lastAssistant(c.messages);
	const call = pendingCall(c.messages, step);
	if (call)
		return {
			kind: "tool",
			call,
			step,
			checkpoint: isWrite(call) && c.checkpointed !== step,
		};
	const last = c.messages.at(-1);
	if (last?.role === "assistant" && !last.toolCalls?.length)
		return { kind: "complete", summary: last.content };
	return modelOrLimit(c, budget, at);
};
