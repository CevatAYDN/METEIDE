import { type ChatMessage, toolName } from "@mete/contracts";
import { z } from "zod";
import type { RunContext } from "./run-machine.js";
import { waitingForHuman } from "./team.js";
import { EXTERNAL_LABEL } from "./tools.js";

// A run's handoff (docs/08, Run memory; ADR-041), built from its snapshot without a model call.
// It names what failed and what changed; prompts and tool output are never copied into it.
// shortcut: checkpoint refs and model calls that failed and were retried are not in the
// snapshot (gateway's model_calls has them); a handoff reads only the snapshot until a reader
// for those tables exists.

type Assistant = Extract<ChatMessage, { role: "assistant" }>;

const conversations = (c: RunContext): readonly (readonly ChatMessage[])[] => [
	c.messages,
	...Object.values(c.team?.tasks ?? {}).map((t) => t.messages),
];

// The error code of a tool result that failed, read past the external-content label.
const failedCode = (content: string) => {
	const json = content.startsWith(EXTERNAL_LABEL)
		? content.slice(EXTERNAL_LABEL.length + 1)
		: content;
	let value: unknown;
	try {
		value = JSON.parse(json);
	} catch {
		return "unreadable"; // a result that is no JSON is reported, not hidden
	}
	const r = FailedSchema.safeParse(value);
	return r.success ? (r.data.error?.code ?? "unknown") : undefined;
};

const FailedSchema = z.object({
	ok: z.literal(false),
	error: z.object({ code: z.string() }).optional(),
});

const failedCalls = (messages: readonly ChatMessage[]) => {
	const names = new Map(
		messages
			.filter((m): m is Assistant => m.role === "assistant")
			.flatMap((m) => m.toolCalls ?? [])
			.map((call) => [call.id, call.name]),
	);
	return messages.flatMap((m) => {
		if (m.role !== "tool") return [];
		const code = failedCode(m.content);
		return code ? [`${names.get(m.toolCallId) ?? "tool"}: ${code}`] : [];
	});
};

const PathSchema = z.object({ path: z.string() });

const WRITES = new Set([toolName("fs.write@1"), toolName("fs.edit@1")]);

const changedFiles = (messages: readonly ChatMessage[]) =>
	messages
		.filter((m): m is Assistant => m.role === "assistant")
		.flatMap((m) => m.toolCalls ?? [])
		.filter((call) => WRITES.has(call.name))
		.flatMap((call) => {
			const r = PathSchema.safeParse(call.args);
			return r.success ? [r.data.path] : [];
		});

const stoppedAt = (c: RunContext, status: string) => {
	const reason = c.pause ? ` (${c.pause.reason})` : "";
	const task = c.task
		? c.team?.template.tasks.find((t) => t.id === c.task)
		: undefined;
	const where = task
		? `, task "${task.title}" ${c.team?.tasks[task.id]?.status}`
		: "";
	return `${status}${reason}${where}`;
};

const openQuestion = (c: RunContext) => {
	if (!c.pause) return undefined;
	const waiting = c.team ? waitingForHuman(c.team) : [];
	const titles = waiting.map(
		(id) => c.team?.template.tasks.find((t) => t.id === id)?.title ?? id,
	);
	return titles.length > 0
		? `waiting for you: ${titles.join(", ")}`
		: `paused for ${c.pause.reason}`;
};

const list = (title: string, items: readonly string[]) =>
	items.length > 0 ? [`${title}:`, ...items.map((i) => `- ${i}`)] : [];

// shortcut: only fs.write and fs.edit arguments; a file a shell command or a commit wrote is missing
// until a request gives a run's changes (ADR-133).
/** The paths the run's agents wrote or edited, each once; the handoff and its event share them. */
export const filesChanged = (c: RunContext): string[] => [
	...new Set(conversations(c).flatMap(changedFiles)),
];

/** The Markdown body of a run's handoff at a stop with status `status`. */
export const handoffBody = (c: RunContext, status: string) => {
	const all = conversations(c);
	const question = openQuestion(c);
	return [
		"# Handoff",
		`Goal: ${c.goal}`,
		`Stopped: ${stoppedAt(c, status)}`,
		...(c.error ? [`Failed with: ${c.error.code}`] : []),
		...(question ? [`Open question: ${question}`] : []),
		...list("Failed tool calls", all.flatMap(failedCalls)),
		...list("Files changed", filesChanged(c)),
	].join("\n");
};
