import type { ChatMessage, Tier } from "@mete/contracts";
import type {
	CreateMessageRequestParams,
	ModelPreferences,
	SamplingMessage,
} from "@modelcontextprotocol/sdk/types.js";
import { SAMPLING_PRIORITY_HIGH } from "../defaults.js";

// What a server's sampling request becomes for llm.chat@2 (docs/10, MCP client).

const blocksOf = (content: SamplingMessage["content"]) =>
	Array.isArray(content) ? content : [content];

/** The tier for a request's priorities; model-name hints are ignored, no model name belongs in core code. */
export const tierOf = (prefs: ModelPreferences | undefined): Tier => {
	const smart = prefs?.intelligencePriority ?? 0;
	const quick = prefs?.speedPriority ?? 0;
	if (smart >= SAMPLING_PRIORITY_HIGH && smart >= quick) return "reasoning";
	return quick >= SAMPLING_PRIORITY_HIGH ? "fast" : "coder";
};

/**
 * Why METE cannot answer the request, or undefined when it can.
 * shortcut: text messages only and no tools in the request; upgrade with vision and tool sampling when a server needs them.
 */
export const samplingRefusal = (
	p: CreateMessageRequestParams,
): string | undefined => {
	if (p.tools?.length || p.toolChoice)
		return "sampling with tools is not supported yet";
	const text = p.messages.every((m) =>
		blocksOf(m.content).every((b) => b.type === "text"),
	);
	return text ? undefined : "sampling answers text messages only";
};

/** The conversation of a request: its system prompt first, then its messages as plain text. */
export const messagesOf = (p: CreateMessageRequestParams): ChatMessage[] => [
	...(p.systemPrompt
		? [{ role: "system" as const, content: p.systemPrompt }]
		: []),
	...p.messages.map((m) => ({
		role: m.role,
		content: blocksOf(m.content)
			.map((b) => (b.type === "text" ? b.text : ""))
			.join("\n"),
	})),
];
