import { describe, expect, it } from "vitest";
import {
	errorResponse,
	toLlmRequest,
	toTarget,
	toWireChunk,
	toWireCompletion,
	WireRequestSchema,
} from "../../src/infrastructure/openai-wire.js";

const RUN = {
	runId: "7f3c2a1e-4b5d-4c6e-8f9a-0b1c2d3e4f5a",
	priority: 1,
} as const;
const NOW = Date.parse("2026-10-21T12:00:00Z");
const frame = { id: "chatcmpl-1", created: 1, model: "a/m" };

const parse = (body: unknown) => WireRequestSchema.parse(body);

describe("toTarget", () => {
	it("reads mete/<tier> and splits other ids at the first slash", () => {
		expect(toTarget("mete/coder")).toEqual({ tier: "coder" });
		expect(toTarget("openrouter/qwen/qwen3:free")).toEqual({
			providerId: "openrouter",
			modelId: "qwen/qwen3:free",
		});
		for (const bad of ["mete/huge", "nomodel", "/m", "p/"])
			expect(toTarget(bad)).toBeUndefined();
	});
});

describe("toLlmRequest", () => {
	it("maps messages, tool calls, tools and token limits", () => {
		const r = toLlmRequest(
			parse({
				model: "mete/coder",
				messages: [
					{
						role: "system",
						content: [
							{ type: "text", text: "be " },
							{ type: "text", text: "brief" },
						],
					},
					{
						role: "user",
						content: [
							{ type: "text", text: "what is this?" },
							{
								type: "image_url",
								image_url: { url: "data:image/png;base64,iVBORw0KGgo=" },
							},
						],
					},
					{
						role: "assistant",
						content: null,
						tool_calls: [
							{
								id: "c1",
								type: "function",
								function: { name: "fs.read", arguments: '{"path":"a"}' },
							},
						],
					},
					{ role: "tool", tool_call_id: "c1", content: "x" },
				],
				tools: [
					{
						type: "function",
						function: { name: "fs.read", parameters: { type: "object" } },
					},
				],
				max_tokens: 50,
				max_completion_tokens: 40,
				temperature: 0.2,
				top_p: 0.9,
			}),
			RUN,
		);
		expect(r).toEqual({
			ok: true,
			value: {
				target: { tier: "coder" },
				...RUN,
				messages: [
					{ role: "system", content: "be brief" },
					{
						role: "user",
						content: [
							{ type: "text", text: "what is this?" },
							{ type: "image", mediaType: "image/png", data: "iVBORw0KGgo=" },
						],
					},
					{
						role: "assistant",
						content: "",
						toolCalls: [{ id: "c1", name: "fs.read", args: { path: "a" } }],
					},
					{ role: "tool", toolCallId: "c1", content: "x" },
				],
				tools: [
					{ name: "fs.read", description: "", parameters: { type: "object" } },
				],
				maxTokens: 40,
				temperature: 0.2,
			},
		});
	});

	it("rejects a bad model id and remote image URLs", () => {
		expect(
			toLlmRequest(
				parse({ model: "x", messages: [{ role: "user", content: "hi" }] }),
				RUN,
			).ok,
		).toBe(false);
		const remote = parse({
			model: "mete/vision",
			messages: [
				{
					role: "user",
					content: [
						{ type: "image_url", image_url: { url: "https://x.test/a.png" } },
					],
				},
			],
		});
		expect(toLlmRequest(remote, RUN)).toEqual({
			ok: false,
			error: "image parts must be base64 data URLs",
		});
	});

	it("keeps tool arguments that are not JSON as text", () => {
		const r = toLlmRequest(
			parse({
				model: "mete/coder",
				messages: [
					{
						role: "assistant",
						tool_calls: [
							{
								id: "c",
								type: "function",
								function: { name: "t", arguments: "{oops" },
							},
						],
					},
				],
			}),
			RUN,
		);
		expect(r.ok && r.value.messages[0]).toEqual({
			role: "assistant",
			content: "",
			toolCalls: [{ id: "c", name: "t", args: "{oops" }],
		});
	});
});

describe("errorResponse", () => {
	it("maps routed failures to the documented statuses", () => {
		const status = (e: Parameters<typeof errorResponse>[0]) =>
			errorResponse(e, NOW).status;
		expect(status({ code: "no_model", message: "x" })).toBe(503);
		expect(status({ code: "too_large", message: "x" })).toBe(413);
		expect(status({ code: "rate_limited", message: "x" })).toBe(429);
		expect(status({ code: "bad_request", message: "x" })).toBe(400);
		for (const code of ["unauthorized", "server", "network"] as const)
			expect(status({ code, message: "x" })).toBe(502);
		const q = errorResponse(
			{
				code: "quota_exhausted",
				message: "full",
				resumesAt: new Date(NOW + 30_500).toISOString(),
			},
			NOW,
		);
		expect(q).toEqual({
			status: 429,
			headers: { "retry-after": "31" },
			body: {
				error: {
					message: "full",
					type: "quota_exhausted",
					code: "quota_exhausted",
				},
			},
		});
	});
});

describe("wire responses", () => {
	const finish = {
		type: "finish",
		reason: "tool-calls",
		usage: { prompt: 3, completion: 2 },
	} as const;

	it("streams text, tool calls and the finish with usage", () => {
		expect(
			toWireChunk({ type: "text", text: "hi" }, frame, 0).choices[0]?.delta,
		).toEqual({ content: "hi" });
		expect(
			toWireChunk(
				{ type: "tool-call", id: "c", name: "t", args: { a: 1 } },
				frame,
				2,
			).choices[0]?.delta,
		).toEqual({
			tool_calls: [
				{
					index: 2,
					id: "c",
					type: "function",
					function: { name: "t", arguments: '{"a":1}' },
				},
			],
		});
		expect(toWireChunk(finish, frame, 0)).toMatchObject({
			object: "chat.completion.chunk",
			model: "a/m",
			choices: [{ finish_reason: "tool_calls" }],
			usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
		});
	});

	it("builds a whole completion with null content when only tools were called", () => {
		const c = toWireCompletion(
			"",
			[{ id: "c", name: "t", args: {} }],
			finish,
			frame,
		);
		expect(c.choices[0]?.message).toEqual({
			role: "assistant",
			content: null,
			tool_calls: [
				{
					index: 0,
					id: "c",
					type: "function",
					function: { name: "t", arguments: "{}" },
				},
			],
		});
		expect(
			toWireCompletion("ok", [], { ...finish, reason: "stop" }, frame)
				.choices[0],
		).toMatchObject({
			message: { role: "assistant", content: "ok" },
			finish_reason: "stop",
		});
	});
});
