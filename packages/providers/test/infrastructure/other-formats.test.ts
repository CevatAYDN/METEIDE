import type { ChatChunk, ChatRequest } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import {
	anthropicChat,
	type EndpointCall,
	googleChat,
	listAnthropicModels,
	listGoogleModels,
} from "../../src/infrastructure/other-formats.js";

// Fake endpoints in each format; no test reaches a real provider.
type Seen = { url: string; headers: Headers };

const call = (fetch: EndpointCall["fetch"], baseUrl: string): EndpointCall => ({
	providerId: "custom:x",
	baseUrl,
	apiKey: "k",
	headers: { "x-team": "mete" },
	fetch,
});

const recorder = (respond: (url: string) => Response) => {
	const seen: Seen[] = [];
	const fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
		seen.push({ url: String(url), headers: new Headers(init?.headers) });
		return respond(String(url));
	};
	return { fetch, seen };
};

const sse = (events: unknown[], named = false) =>
	new Response(
		events
			.map((e) =>
				named
					? `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`
					: `data: ${JSON.stringify(e)}\n\n`,
			)
			.join(""),
		{ headers: { "content-type": "text/event-stream" } },
	);

const req: ChatRequest = {
	model: "m",
	messages: [{ role: "user", content: "hi" }],
	maxTokens: 32,
};

const collect = async (chunks: AsyncIterable<ChatChunk>) => {
	const out: ChatChunk[] = [];
	for await (const c of chunks) out.push(c);
	return out;
};

const signal = () => new AbortController().signal;

describe("anthropic-messages endpoints", () => {
	it("list models with x-api-key and anthropic-version, reading context, vision and lifecycle", async () => {
		const r = recorder(() =>
			Response.json({
				data: [
					{
						id: "claude-a",
						max_input_tokens: 200_000,
						capabilities: { image_input: { supported: true } },
						lifecycle: "active",
					},
					{ id: "claude-old", max_input_tokens: null, lifecycle: "deprecated" },
				],
				has_more: false,
			}),
		);
		const list = await listAnthropicModels(
			call(r.fetch, "https://a.test/v1"),
			signal(),
		);
		expect(r.seen[0]?.url).toBe("https://a.test/v1/models?limit=1000");
		expect(r.seen[0]?.headers.get("x-api-key")).toBe("k");
		expect(r.seen[0]?.headers.get("anthropic-version")).toBe("2023-06-01");
		expect(r.seen[0]?.headers.get("authorization")).toBeNull();
		expect(r.seen[0]?.headers.get("x-team")).toBe("mete");
		expect(
			list.ok &&
				list.value.map((m) => [m.id, m.contextWindow, m.vision, m.deprecated]),
		).toEqual([
			["claude-a", 200_000, true, false],
			["claude-old", 0, "unknown", true],
		]);
	});

	it("streams a chat into text and one finish", async () => {
		const r = recorder(() =>
			sse(
				[
					{
						type: "message_start",
						message: {
							id: "msg_1",
							type: "message",
							role: "assistant",
							model: "m",
							content: [],
							stop_reason: null,
							usage: { input_tokens: 9, output_tokens: 1 },
						},
					},
					{
						type: "content_block_start",
						index: 0,
						content_block: { type: "text", text: "" },
					},
					{
						type: "content_block_delta",
						index: 0,
						delta: { type: "text_delta", text: "Hi" },
					},
					{ type: "content_block_stop", index: 0 },
					{
						type: "message_delta",
						delta: { stop_reason: "end_turn", stop_sequence: null },
						usage: { output_tokens: 2 },
					},
					{ type: "message_stop" },
				],
				true,
			),
		);
		const out = await collect(
			anthropicChat(call(r.fetch, "https://a.test/v1"))(req, signal()),
		);
		expect(r.seen[0]?.url).toBe("https://a.test/v1/messages");
		expect(out[0]).toEqual({ type: "text", text: "Hi" });
		expect(out.at(-1)).toMatchObject({ type: "finish", reason: "stop" });
	});
});

describe("google-gemini endpoints", () => {
	it("list content models with x-goog-api-key, dropping the models/ prefix", async () => {
		const r = recorder(() =>
			Response.json({
				models: [
					{
						name: "models/gemini-x",
						inputTokenLimit: 1_048_576,
						supportedGenerationMethods: ["generateContent", "countTokens"],
					},
					{
						name: "models/embedder",
						supportedGenerationMethods: ["embedContent"],
					},
				],
			}),
		);
		const list = await listGoogleModels(
			call(r.fetch, "https://g.test/v1beta"),
			signal(),
		);
		expect(r.seen[0]?.url).toBe("https://g.test/v1beta/models?pageSize=1000");
		expect(r.seen[0]?.headers.get("x-goog-api-key")).toBe("k");
		expect(r.seen[0]?.headers.get("authorization")).toBeNull();
		expect(list.ok && list.value.map((m) => [m.id, m.contextWindow])).toEqual([
			["gemini-x", 1_048_576],
		]);
	});

	it("streams a chat into text and one finish", async () => {
		const r = recorder(() =>
			sse([
				{
					candidates: [
						{ content: { role: "model", parts: [{ text: "Hi" }] }, index: 0 },
					],
				},
				{
					candidates: [
						{
							content: { role: "model", parts: [{ text: "!" }] },
							finishReason: "STOP",
							index: 0,
						},
					],
					usageMetadata: {
						promptTokenCount: 4,
						candidatesTokenCount: 2,
						totalTokenCount: 6,
					},
				},
			]),
		);
		const out = await collect(
			googleChat(call(r.fetch, "https://g.test/v1beta"))(req, signal()),
		);
		expect(r.seen[0]?.url).toContain(
			"https://g.test/v1beta/models/m:streamGenerateContent",
		);
		expect(r.seen[0]?.headers.get("x-goog-api-key")).toBe("k");
		expect(
			out
				.filter((c) => c.type === "text")
				.map((c) => c.type === "text" && c.text),
		).toEqual(["Hi", "!"]);
		expect(out.at(-1)).toMatchObject({
			type: "finish",
			reason: "stop",
			usage: { prompt: 4, completion: 2 },
		});
	});
});
