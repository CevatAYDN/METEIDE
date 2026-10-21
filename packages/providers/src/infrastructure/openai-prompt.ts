import type { OpenAICompatibleProvider } from "@ai-sdk/openai-compatible";
import type { ChatMessage, ToolSpec } from "@mete/contracts";

// METE chat messages to the AI SDK call format; the SDK writes the OpenAI request body.
// The types come from the SDK's own signature, so @ai-sdk/provider is not imported.

/** What the SDK's chat model takes in one streaming call. */
export type CallOptions = Parameters<
	ReturnType<OpenAICompatibleProvider["chatModel"]>["doStream"]
>[0];
type Prompt = CallOptions["prompt"];
type Tools = NonNullable<CallOptions["tools"]>;

const userContent = (
	content: Extract<ChatMessage, { role: "user" }>["content"],
) =>
	typeof content === "string"
		? [{ type: "text" as const, text: content }]
		: content.map((p) =>
				p.type === "text"
					? { type: "text" as const, text: p.text }
					: {
							type: "file" as const,
							mediaType: p.mediaType,
							data: { type: "data" as const, data: p.data },
						},
			);

// The SDK wants a tool result's tool name; the assistant message that asked for the call has it.
const toolNames = (messages: readonly ChatMessage[]) =>
	new Map(
		messages.flatMap((m) =>
			m.role === "assistant"
				? (m.toolCalls ?? []).map((c) => [c.id, c.name] as const)
				: [],
		),
	);

/** The conversation in the SDK's prompt format. */
export const toPrompt = (messages: readonly ChatMessage[]): Prompt => {
	const names = toolNames(messages);
	return messages.map((m): Prompt[number] => {
		switch (m.role) {
			case "system":
				return { role: "system", content: m.content };
			case "user":
				return { role: "user", content: userContent(m.content) };
			case "assistant":
				return {
					role: "assistant",
					content: [
						...(m.content === ""
							? []
							: [{ type: "text" as const, text: m.content }]),
						...(m.toolCalls ?? []).map((c) => ({
							type: "tool-call" as const,
							toolCallId: c.id,
							toolName: c.name,
							input: c.args,
						})),
					],
				};
			default:
				return {
					role: "tool",
					content: [
						{
							type: "tool-result",
							toolCallId: m.toolCallId,
							toolName: names.get(m.toolCallId) ?? "",
							output: { type: "text", value: m.content },
						},
					],
				};
		}
	});
};

type JsonSchema = Extract<Tools[number], { type: "function" }>["inputSchema"];

/** Tools as JSON-schema function tools. */
export const toTools = (tools: readonly ToolSpec[]): Tools =>
	tools.map((t) => ({
		type: "function",
		name: t.name,
		description: t.description,
		// The schema is passed to the provider as written; the tool layer owns its shape.
		inputSchema: t.parameters as JsonSchema,
	}));
