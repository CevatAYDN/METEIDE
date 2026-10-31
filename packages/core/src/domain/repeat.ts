import type { ChatMessage, ToolCall } from "@mete/contracts";
import { REPEAT_LIMIT } from "../defaults.js";
import { REPEAT_LABEL, resultJson } from "./tools.js";

// The repeat guard of ADR-166: a tool call whose result is the same as that of its last calls with
// the same arguments gets a line before it. Pure; it reads the conversation, so it keeps no state.
// Turns folded into a summary are not read, so after a fold the count starts again (ADR-166 (3)).

type ToolMessage = Extract<ChatMessage, { role: "tool" }>;

// Object keys sorted, so arguments in another key order are the same call.
const sorted = (_: string, v: unknown) =>
	v && typeof v === "object" && !Array.isArray(v)
		? Object.fromEntries(
				Object.entries(v).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)),
			)
		: v;

const keyOf = (c: ToolCall) => `${c.name}\n${JSON.stringify(c.args, sorted)}`;

// The results that follow an assistant message; a call's id is matched in its own turn only,
// because some providers reuse ids across turns.
const repliesAfter = (messages: readonly ChatMessage[], i: number) => {
	const replies = new Map<string, string>();
	for (let j = i + 1; j < messages.length; j++) {
		const m = messages[j];
		if (m?.role !== "tool") break;
		replies.set(m.toolCallId, resultJson(m.content));
	}
	return replies;
};

// Every answered call of the conversation, in order: its key and its result.
const answered = (messages: readonly ChatMessage[]) =>
	messages.flatMap((m, i) => {
		if (m.role !== "assistant" || !m.toolCalls) return [];
		const replies = repliesAfter(messages, i);
		return m.toolCalls.flatMap((c) => {
			const result = replies.get(c.id);
			return result === undefined ? [] : [{ key: keyOf(c), result }];
		});
	});

const repeats = (
	messages: readonly ChatMessage[],
	call: ToolCall,
	content: string,
) => {
	const key = keyOf(call);
	const result = resultJson(content);
	const same = answered(messages)
		.filter((a) => a.key === key)
		.reverse();
	const streak = same.findIndex((a) => a.result !== result);
	return (streak === -1 ? same.length : streak) + 1 >= REPEAT_LIMIT;
};

/** A call's result message, with the repeat line before it when it repeats (ADR-166). */
export const guarded = (
	messages: readonly ChatMessage[],
	call: ToolCall,
	message: ToolMessage,
): ToolMessage =>
	repeats(messages, call, message.content)
		? { ...message, content: `${REPEAT_LABEL}\n${message.content}` }
		: message;
