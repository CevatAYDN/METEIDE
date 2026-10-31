import type { ChatMessage, Transcript, TranscriptStep } from "@mete/contracts";
import { z } from "zod";
import { SUMMARY_OPEN } from "./compact.js";
import type { RunContext } from "./run-machine.js";
import { resultJson } from "./tools.js";

// A run's steps from the conversation its snapshot keeps (ADR-125), without the opening (the system
// message and the first user message, as compaction's head, docs/08). Masking is the caller's. Pure.

type Conversation = Transcript["conversations"][number];
type ToolStep = TranscriptStep["toolCalls"][number];
type Assistant = Extract<ChatMessage, { role: "assistant" }>;

/** Cuts a text at `max` characters and says how many it cut. */
export const cut = (text: string, max: number) =>
	text.length <= max
		? text
		: `${text.slice(0, max)} [${text.length - max} characters cut]`;

// What steps.ts stores for a tool call: its Result as JSON.
const StoredSchema = z.union([
	z.object({ ok: z.literal(true), value: z.unknown() }),
	z.object({ ok: z.literal(false), error: z.object({ message: z.string() }) }),
]);

const parsed = (json: string): unknown => {
	try {
		return JSON.parse(json);
	} catch {
		return undefined;
	}
};

// Read past the label lines (steps.ts, ADR-166); content that is no stored Result stays as text.
const resultOf = (content: string): NonNullable<ToolStep["result"]> => {
	const r = StoredSchema.safeParse(parsed(resultJson(content)));
	if (!r.success) return { text: content };
	if (!r.data.ok) return { ok: false, text: r.data.error.message };
	return { ok: true, text: JSON.stringify(r.data.value) ?? "" };
};

const assistantStep = (
	m: Assistant,
	results: ReadonlyMap<string, string>,
): TranscriptStep => ({
	...(m.content ? { text: m.content } : {}),
	toolCalls: (m.toolCalls ?? []).map((c) => {
		const answer = results.get(c.id);
		return {
			name: c.name,
			args: JSON.stringify(c.args) ?? "",
			...(answer === undefined ? {} : { result: resultOf(answer) }),
		};
	}),
});

const userText = (
	content: Extract<ChatMessage, { role: "user" }>["content"],
) =>
	typeof content === "string"
		? content
		: content.map((p) => (p.type === "text" ? p.text : "[image]")).join("\n");

/** The steps of one conversation: each assistant message with its tool results, and later user messages. */
export const stepsOf = (messages: readonly ChatMessage[]): TranscriptStep[] => {
	const results = new Map(
		messages.flatMap((m) =>
			m.role === "tool" ? [[m.toolCallId, m.content] as const] : [],
		),
	);
	return messages.slice(2).flatMap((m): TranscriptStep[] => {
		if (m.role === "assistant") return [assistantStep(m, results)];
		if (m.role !== "user") return [];
		const text = userText(m.content);
		const from = text.startsWith(SUMMARY_OPEN) ? "summary" : "user";
		return [{ text, toolCalls: [], from }];
	});
};

type Source = Pick<
	RunContext,
	"messages" | "agent" | "team" | "task" | "review"
>;

// A team's tasks in template order: the active one's conversation is in `messages`, unless a review
// holds them; the others keep theirs in their entry. A running review is a conversation of its own.
const teamConversations = (
	c: Source,
	team: NonNullable<Source["team"]>,
): Conversation[] => {
	const tasks = team.template.tasks.flatMap((t) => {
		const entry = team.tasks[t.id];
		const live = c.task === t.id && !c.review;
		const messages = live ? c.messages : (entry?.messages ?? []);
		if (!entry || messages.length === 0) return [];
		return [{ taskId: entry.id, roleId: t.role, steps: stepsOf(messages) }];
	});
	const reviewed = c.task ? team.tasks[c.task] : undefined;
	if (!c.review || !reviewed) return tasks;
	const review = { roleId: c.review, steps: stepsOf(c.messages) };
	return [...tasks, { taskId: reviewed.id, ...review }];
};

/** A run's conversations: the single agent's, or the team's per task and running review. */
export const conversationsOf = (c: Source): Conversation[] =>
	c.team
		? teamConversations(c, c.team)
		: [{ roleId: c.agent?.roleId ?? "assistant", steps: stepsOf(c.messages) }];
