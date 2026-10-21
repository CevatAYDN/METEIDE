import type { ChatChunk, ChatRequest } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import { createOpenAIChat } from "../../src/infrastructure/openai-chat.js";

// A fake endpoint: tests never call a real provider (AGENTS.md); each test scripts
// the HTTP response and reads back the request the SDK sent.
const sse = (events: unknown[]) =>
	`${events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("")}data: [DONE]\n\n`;

const endpoint = (respond: (body: Record<string, unknown>) => Response) => {
	const sent: Record<string, unknown>[] = [];
	const fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
		const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
		sent.push(body);
		return respond(body);
	};
	return { fetch, sent };
};

const stream = (events: unknown[], headers: Record<string, string> = {}) =>
	new Response(sse(events), {
		headers: { "content-type": "text/event-stream", ...headers },
	});

const delta = (d: Record<string, unknown>, finish: string | null = null) => ({
	id: "c1",
	object: "chat.completion.chunk",
	created: 0,
	model: "m",
	choices: [{ index: 0, delta: d, finish_reason: finish }],
});

const usage = {
	id: "c1",
	object: "chat.completion.chunk",
	created: 0,
	model: "m",
	choices: [],
	usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 },
};

const req: ChatRequest = {
	model: "m",
	messages: [{ role: "user", content: "hi" }],
};

const collect = async (chunks: AsyncIterable<ChatChunk>) => {
	const out: ChatChunk[] = [];
	for await (const c of chunks) out.push(c);
	return out;
};

const chatWith = (fake: ReturnType<typeof endpoint>) =>
	createOpenAIChat({
		name: "test",
		baseURL: "https://provider.test/v1",
		apiKey: "k",
		fetch: fake.fetch,
	});

const signal = () => new AbortController().signal;

describe("openai chat: streaming", () => {
	it("streams text and ends with one finish carrying usage", async () => {
		const fake = endpoint(() =>
			stream([
				delta({ role: "assistant", content: "Hel" }),
				delta({ content: "lo" }),
				delta({}, "stop"),
				usage,
			]),
		);
		expect(await collect(chatWith(fake).chat(req, signal()))).toEqual([
			{ type: "text", text: "Hel" },
			{ type: "text", text: "lo" },
			{ type: "finish", reason: "stop", usage: { prompt: 12, completion: 5 } },
		]);
	});

	it("turns a streamed tool call into one chunk with parsed arguments", async () => {
		const fake = endpoint(() =>
			stream([
				delta({
					role: "assistant",
					tool_calls: [
						{
							index: 0,
							id: "call_1",
							type: "function",
							function: { name: "fs_read", arguments: '{"path":' },
						},
					],
				}),
				delta({
					tool_calls: [{ index: 0, function: { arguments: '"a.ts"}' } }],
				}),
				delta({}, "tool_calls"),
				usage,
			]),
		);
		const out = await collect(chatWith(fake).chat(req, signal()));
		expect(out).toEqual([
			{
				type: "tool-call",
				id: "call_1",
				name: "fs_read",
				args: { path: "a.ts" },
			},
			{
				type: "finish",
				reason: "tool-calls",
				usage: { prompt: 12, completion: 5 },
			},
		]);
	});

	it("ends with an error chunk when the provider ends the stream with an error", async () => {
		const fake = endpoint(() =>
			stream([delta({ content: "par" }), delta({}, "error"), usage]),
		);
		const out = await collect(chatWith(fake).chat(req, signal()));
		expect(out.at(-1)).toMatchObject({
			type: "error",
			error: { code: "server" },
		});
		expect(
			out.filter((c) => c.type === "finish" || c.type === "error"),
		).toHaveLength(1);
	});
});

describe("openai chat: errors", () => {
	it("maps a 429 to rate_limited and keeps status and headers for observe()", async () => {
		const fake = endpoint(
			() =>
				new Response(JSON.stringify({ error: { message: "slow down" } }), {
					status: 429,
					headers: { "retry-after": "7", "content-type": "application/json" },
				}),
		);
		const [only, ...rest] = await collect(chatWith(fake).chat(req, signal()));
		expect(rest).toEqual([]);
		expect(only?.type).toBe("error");
		if (only?.type !== "error") return;
		expect(only.error.code).toBe("rate_limited");
		expect(only.error.status).toBe(429);
		expect(only.error.headers?.get("retry-after")).toBe("7");
	});

	it("maps 401, 400 and 503, and a failed fetch to network", async () => {
		const status = async (code: number) => {
			const fake = endpoint(
				() =>
					new Response(JSON.stringify({ error: { message: "x" } }), {
						status: code,
						headers: { "content-type": "application/json" },
					}),
			);
			const [c] = await collect(chatWith(fake).chat(req, signal()));
			return c?.type === "error" ? c.error.code : undefined;
		};
		expect(await status(401)).toBe("unauthorized");
		expect(await status(400)).toBe("bad_request");
		expect(await status(503)).toBe("server");
		const down = createOpenAIChat({
			name: "test",
			baseURL: "https://provider.test/v1",
			apiKey: "k",
			fetch: async () => {
				throw new TypeError("fetch failed");
			},
		});
		const [c] = await collect(down.chat(req, signal()));
		expect(c).toMatchObject({ type: "error", error: { code: "network" } });
	});

	it("returns aborted when the signal is already aborted", async () => {
		const fake = endpoint(() =>
			stream([delta({ content: "x" }), delta({}, "stop"), usage]),
		);
		const c = new AbortController();
		c.abort();
		const [only] = await collect(chatWith(fake).chat(req, c.signal));
		expect(only).toMatchObject({ type: "error", error: { code: "aborted" } });
	});
});

describe("openai chat: request", () => {
	it("sends messages, images, tool results, tools and limits in the OpenAI format", async () => {
		const fake = endpoint(() => stream([delta({}, "stop"), usage]));
		await collect(
			chatWith(fake).chat(
				{
					model: "m",
					messages: [
						{ role: "system", content: "be brief" },
						{
							role: "user",
							content: [
								{ type: "text", text: "see" },
								{ type: "image", mediaType: "image/png", data: "iVBORw0KGgo=" },
							],
						},
						{
							role: "assistant",
							content: "",
							toolCalls: [{ id: "c1", name: "fs_read", args: { path: "a" } }],
						},
						{ role: "tool", toolCallId: "c1", content: "body" },
					],
					tools: [
						{
							name: "fs_read",
							description: "Read",
							parameters: { type: "object" },
						},
					],
					maxTokens: 64,
					temperature: 0.1,
				},
				signal(),
			),
		);
		const body = fake.sent[0];
		expect(body).toMatchObject({
			model: "m",
			max_tokens: 64,
			temperature: 0.1,
			stream: true,
			tools: [
				{
					type: "function",
					function: { name: "fs_read", description: "Read" },
				},
			],
		});
		expect(body?.messages).toEqual([
			{ role: "system", content: "be brief" },
			{
				role: "user",
				content: [
					{ type: "text", text: "see" },
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
						function: { name: "fs_read", arguments: '{"path":"a"}' },
					},
				],
			},
			{ role: "tool", tool_call_id: "c1", content: "body" },
		]);
	});
});

describe("openai chat: extras", () => {
	it("adds extraBody fields to the request body", async () => {
		const fake = endpoint(() => stream([delta({}, "stop"), usage]));
		const chat = createOpenAIChat({
			name: "test",
			baseURL: "https://provider.test/v1",
			apiKey: "k",
			fetch: fake.fetch,
			extraBody: { provider: { data_collection: "deny" } },
		});
		await collect(chat.chat(req, signal()));
		expect(fake.sent[0]?.provider).toEqual({ data_collection: "deny" });
	});

	it("ends with a network error when the stream stops without a finish", async () => {
		const fake = endpoint(
			() =>
				new Response(`data: ${JSON.stringify(delta({ content: "x" }))}\n\n`, {
					headers: { "content-type": "text/event-stream" },
				}),
		);
		const out = await collect(chatWith(fake).chat(req, signal()));
		expect(out.at(-1)).toMatchObject({
			type: "error",
			error: { code: "network" },
		});
	});

	it("embeds inputs in order and maps a failure", async () => {
		const ok = endpoint(
			(body) =>
				new Response(
					JSON.stringify({
						data: (body.input as string[]).map((_, index) => ({
							embedding: [index, 0.5],
							index,
						})),
						usage: { prompt_tokens: 2 },
					}),
					{ headers: { "content-type": "application/json" } },
				),
		);
		expect(
			await chatWith(ok).embed({ model: "e", input: ["a", "b"] }, signal()),
		).toEqual({
			ok: true,
			value: {
				vectors: [
					[0, 0.5],
					[1, 0.5],
				],
			},
		});
		const down = endpoint(
			() =>
				new Response(JSON.stringify({ error: { message: "no" } }), {
					status: 401,
					headers: { "content-type": "application/json" },
				}),
		);
		const r = await chatWith(down).embed(
			{ model: "e", input: ["a"] },
			signal(),
		);
		expect(!r.ok && r.error.code).toBe("unauthorized");
	});
});
