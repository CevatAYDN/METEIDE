import {
	type ChatMessage,
	type ContentPart,
	err,
	type LlmChatRequest,
	type LlmChunk,
	type LlmError,
	ok,
	type Result,
	TierSchema,
	type ToolCall,
} from "@mete/contracts";
import { z } from "zod";

// The OpenAI chat-completions wire format of the gateway's HTTP endpoints (docs/09, Gateway).

const TextPart = z.looseObject({ type: z.literal("text"), text: z.string() });
const ImagePart = z.looseObject({
	type: z.literal("image_url"),
	image_url: z.looseObject({ url: z.string() }),
});
const WireToolCall = z.looseObject({
	id: z.string().min(1),
	type: z.literal("function"),
	function: z.looseObject({ name: z.string().min(1), arguments: z.string() }),
});

const WireMessage = z.discriminatedUnion("role", [
	z.looseObject({
		role: z.literal("system"),
		content: z.union([z.string(), z.array(TextPart)]),
	}),
	z.looseObject({
		role: z.literal("user"),
		content: z.union([
			z.string(),
			z.array(z.union([TextPart, ImagePart])).min(1),
		]),
	}),
	z.looseObject({
		role: z.literal("assistant"),
		content: z.string().nullish(),
		tool_calls: z.array(WireToolCall).optional(),
	}),
	z.looseObject({
		role: z.literal("tool"),
		tool_call_id: z.string().min(1),
		content: z.string(),
	}),
]);

/** The body of `POST /v1/chat/completions`; fields METE does not use are ignored. */
export const WireRequestSchema = z.looseObject({
	model: z.string().min(1),
	messages: z.array(WireMessage).min(1),
	tools: z
		.array(
			z.looseObject({
				type: z.literal("function"),
				function: z.looseObject({
					name: z.string().min(1),
					description: z.string().default(""),
					parameters: z.unknown().default({}),
				}),
			}),
		)
		.optional(),
	max_tokens: z.number().int().positive().optional(),
	max_completion_tokens: z.number().int().positive().optional(),
	temperature: z.number().min(0).optional(),
	stream: z.boolean().default(false),
});

type WireRequest = z.infer<typeof WireRequestSchema>;
type WirePart = z.infer<typeof TextPart> | z.infer<typeof ImagePart>;

const DATA_URL = /^data:([^;,]+);base64,(.+)$/;

// Only data URLs: fetching an image would be a network call outside an adapter.
const toPart = (p: WirePart): ContentPart | undefined => {
	if (p.type === "text") return { type: "text", text: p.text };
	const m = DATA_URL.exec(p.image_url.url);
	return m?.[1] && m[2]
		? { type: "image", mediaType: m[1], data: m[2] }
		: undefined;
};

const parseArgs = (raw: string): unknown => {
	try {
		return JSON.parse(raw);
	} catch {
		return raw; // the tool layer reports a bad call
	}
};

const toToolCall = (c: z.infer<typeof WireToolCall>): ToolCall => ({
	id: c.id,
	name: c.function.name,
	args: parseArgs(c.function.arguments),
});

const isDefined = <T>(x: T | undefined): x is T => x !== undefined;

const joinText = (parts: readonly { text: string }[]) =>
	parts.map((p) => p.text).join("");

const toMessage = (m: z.infer<typeof WireMessage>): ChatMessage | undefined => {
	switch (m.role) {
		case "system":
			return {
				role: "system",
				content:
					typeof m.content === "string" ? m.content : joinText(m.content),
			};
		case "user": {
			if (typeof m.content === "string")
				return { role: "user", content: m.content };
			const parts = m.content.map(toPart).filter(isDefined);
			return parts.length === m.content.length
				? { role: "user", content: parts }
				: undefined;
		}
		case "assistant":
			return {
				role: "assistant",
				content: m.content ?? "",
				...(m.tool_calls ? { toolCalls: m.tool_calls.map(toToolCall) } : {}),
			};
		case "tool":
			return { role: "tool", toolCallId: m.tool_call_id, content: m.content };
	}
};

/** `mete/<tier>` or `<providerId>/<modelId>`, split at the first `/`. */
export const toTarget = (
	model: string,
): LlmChatRequest["target"] | undefined => {
	const cut = model.indexOf("/");
	if (cut <= 0 || cut === model.length - 1) return undefined;
	const head = model.slice(0, cut);
	const tail = model.slice(cut + 1);
	if (head !== "mete") return { providerId: head, modelId: tail };
	const tier = TierSchema.safeParse(tail);
	return tier.success ? { tier: tier.data } : undefined;
};

/** A parsed body as an llm.chat@2 request; the error says what is wrong. */
export const toLlmRequest = (
	body: WireRequest,
	run: { readonly runId: string; readonly priority: 0 | 1 | 2 },
): Result<LlmChatRequest, string> => {
	const target = toTarget(body.model);
	if (!target)
		return err(
			`model must be mete/<tier> or <providerId>/<modelId>, got ${body.model}`,
		);
	const messages = body.messages.map(toMessage).filter(isDefined);
	if (messages.length !== body.messages.length)
		return err("image parts must be base64 data URLs");
	const maxTokens = body.max_completion_tokens ?? body.max_tokens;
	return ok({
		target,
		...run,
		messages,
		...(body.tools
			? {
					tools: body.tools.map((t) => ({
						name: t.function.name,
						description: t.function.description,
						parameters: t.function.parameters,
					})),
				}
			: {}),
		...(maxTokens === undefined ? {} : { maxTokens }),
		...(body.temperature === undefined
			? {}
			: { temperature: body.temperature }),
	});
};

/** The HTTP status and OpenAI error body for a routed failure. */
export const errorResponse = (e: LlmError, now: number) => {
	const body = { error: { message: e.message, type: e.code, code: e.code } };
	switch (e.code) {
		case "no_model":
			return { status: 503, body, headers: {} };
		case "too_large":
			return { status: 413, body, headers: {} };
		case "quota_exhausted": {
			const seconds = Math.max(
				0,
				Math.ceil((Date.parse(e.resumesAt) - now) / 1000),
			);
			return { status: 429, body, headers: { "retry-after": String(seconds) } };
		}
		case "rate_limited":
			return { status: 429, body, headers: {} };
		case "bad_request":
			return { status: 400, body, headers: {} };
		default:
			return { status: 502, body, headers: {} };
	}
};

const FINISH = {
	stop: "stop",
	length: "length",
	"tool-calls": "tool_calls",
	"content-filter": "content_filter",
	other: "stop",
} as const;

type Finish = Extract<LlmChunk, { type: "finish" }>;
type Frame = {
	readonly id: string;
	readonly created: number;
	readonly model: string;
};

const usageOf = (f: Finish) => ({
	prompt_tokens: f.usage.prompt,
	completion_tokens: f.usage.completion,
	total_tokens: f.usage.prompt + f.usage.completion,
});

const wireCall = (c: ToolCall, index: number) => ({
	index,
	id: c.id,
	type: "function",
	function: { name: c.name, arguments: JSON.stringify(c.args) ?? "" },
});

/** One streamed chunk as a `chat.completion.chunk`; `index` counts tool calls so far. */
export const toWireChunk = (
	c: Exclude<LlmChunk, { type: "model" | "error" }>,
	frame: Frame,
	index: number,
) => {
	const base = {
		id: frame.id,
		object: "chat.completion.chunk",
		created: frame.created,
		model: frame.model,
	};
	if (c.type === "text")
		return {
			...base,
			choices: [{ index: 0, delta: { content: c.text }, finish_reason: null }],
		};
	if (c.type === "tool-call")
		return {
			...base,
			choices: [
				{
					index: 0,
					delta: { tool_calls: [wireCall(c, index)] },
					finish_reason: null,
				},
			],
		};
	return {
		...base,
		choices: [{ index: 0, delta: {}, finish_reason: FINISH[c.reason] }],
		usage: usageOf(c),
	};
};

/** A whole answer as a `chat.completion`. */
export const toWireCompletion = (
	text: string,
	calls: readonly ToolCall[],
	finish: Finish,
	frame: Frame,
) => ({
	id: frame.id,
	object: "chat.completion",
	created: frame.created,
	model: frame.model,
	choices: [
		{
			index: 0,
			message: {
				role: "assistant",
				content: text === "" && calls.length > 0 ? null : text,
				...(calls.length > 0 ? { tool_calls: calls.map(wireCall) } : {}),
			},
			finish_reason: FINISH[finish.reason],
		},
	],
	usage: usageOf(finish),
});
