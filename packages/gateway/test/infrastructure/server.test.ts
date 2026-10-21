import type { LlmChatAdapter, LlmChatRequest, LlmChunk } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import {
	createGatewayApp,
	serveGateway,
} from "../../src/infrastructure/server.js";

const TOKEN = "t0k3n";
const RUN = "7f3c2a1e-4b5d-4c6e-8f9a-0b1c2d3e4f5a";
const NOW = Date.parse("2026-10-21T12:00:00Z");

const model: LlmChunk = {
	type: "model",
	providerId: "a",
	modelId: "m",
	reason: "first",
};
const finish: LlmChunk = {
	type: "finish",
	reason: "stop",
	usage: { prompt: 3, completion: 2 },
};

/** A chat that answers every call with `chunks` and keeps what it was asked. */
const fakeChat = (chunks: LlmChunk[]) => {
	const asked: LlmChatRequest[] = [];
	const chat: LlmChatAdapter = {
		async *chat(req) {
			asked.push(req);
			for (const c of chunks) yield c;
		},
	};
	return { chat, asked };
};

const app = (chunks: LlmChunk[]) => {
	const f = fakeChat(chunks);
	const a = createGatewayApp({
		chat: f.chat,
		models: async () => [{ providerId: "a", modelId: "m" }],
		token: TOKEN,
		now: () => NOW,
		newId: () => "chatcmpl-1",
	});
	return { app: a, asked: f.asked };
};

const headers = (extra: Record<string, string> = {}) => ({
	authorization: `Bearer ${TOKEN}`,
	"content-type": "application/json",
	"x-mete-run-id": RUN,
	...extra,
});

const body = (over: Record<string, unknown> = {}) =>
	JSON.stringify({
		model: "mete/coder",
		messages: [{ role: "user", content: "hi" }],
		...over,
	});

const post = (
	a: ReturnType<typeof app>["app"],
	init: { headers?: Record<string, string>; body?: string } = {},
) =>
	a.request("/v1/chat/completions", {
		method: "POST",
		headers: init.headers ?? headers(),
		body: init.body ?? body(),
	});

describe("gateway HTTP app", () => {
	it("rejects a missing or wrong token on every endpoint", async () => {
		const { app: a } = app([model, finish]);
		expect((await a.request("/v1/models")).status).toBe(401);
		const wrong = await a.request("/v1/models", {
			headers: { authorization: "Bearer nope" },
		});
		expect(wrong.status).toBe(401);
		expect(await wrong.json()).toEqual({
			error: {
				message: "missing or wrong session token",
				type: "unauthorized",
				code: "unauthorized",
			},
		});
		expect(
			(await post(a, { headers: { ...headers(), authorization: "" } })).status,
		).toBe(401);
	});

	it("lists tier aliases and usable models", async () => {
		const { app: a } = app([]);
		const res = await a.request("/v1/models", { headers: headers() });
		const ids = ((await res.json()) as { data: { id: string }[] }).data.map(
			(m) => m.id,
		);
		expect(ids).toEqual([
			"mete/reasoning",
			"mete/coder",
			"mete/fast",
			"mete/long-context",
			"mete/vision",
			"a/m",
		]);
	});

	it("answers a whole completion with the serving model and passes run id and priority", async () => {
		const { app: a, asked } = app([
			model,
			{ type: "text", text: "he" },
			{ type: "text", text: "llo" },
			finish,
		]);
		const res = await post(a, { headers: headers({ "x-mete-priority": "0" }) });
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({
			id: "chatcmpl-1",
			object: "chat.completion",
			model: "a/m",
			choices: [
				{
					message: { role: "assistant", content: "hello" },
					finish_reason: "stop",
				},
			],
			usage: { total_tokens: 5 },
		});
		expect(asked[0]).toMatchObject({
			target: { tier: "coder" },
			runId: RUN,
			priority: 0,
		});
	});

	it("streams server-sent chunks and ends with [DONE]", async () => {
		const call: LlmChunk = { type: "tool-call", id: "c", name: "t", args: {} };
		const { app: a } = app([
			model,
			{ type: "text", text: "hi" },
			call,
			call,
			finish,
		]);
		const res = await post(a, { body: body({ stream: true }) });
		expect(res.headers.get("content-type")).toContain("text/event-stream");
		const events = (await res.text()).trim().split("\n\n");
		expect(events.at(-1)).toBe("data: [DONE]");
		const chunks = events
			.slice(0, -1)
			.map((e) => JSON.parse(e.slice("data: ".length)));
		expect(chunks.map((c) => c.choices[0].delta)).toEqual([
			{ content: "hi" },
			{ tool_calls: [expect.objectContaining({ index: 0 })] },
			{ tool_calls: [expect.objectContaining({ index: 1 })] },
			{},
		]);
		expect(chunks[0].model).toBe("a/m");
	});

	it("answers a failure before any content with its HTTP status, also when streaming", async () => {
		const resumesAt = new Date(NOW + 10_000).toISOString();
		const { app: a } = app([
			{
				type: "error",
				error: { code: "quota_exhausted", message: "full", resumesAt },
			},
		]);
		const res = await post(a, { body: body({ stream: true }) });
		expect(res.status).toBe(429);
		expect(res.headers.get("retry-after")).toBe("10");
		const none = app([
			model,
			{ type: "error", error: { code: "no_model", message: "none" } },
		]);
		expect((await post(none.app)).status).toBe(503);
	});

	it("sends a failure after streaming started as an error event, then [DONE]", async () => {
		const { app: a } = app([
			model,
			{ type: "text", text: "par" },
			{ type: "error", error: { code: "server", message: "boom" } },
		]);
		const res = await post(a, { body: body({ stream: true }) });
		expect(res.status).toBe(200);
		const events = (await res.text()).trim().split("\n\n");
		expect(events.slice(1)).toEqual([
			`event: error\ndata: ${JSON.stringify({ error: { message: "boom", type: "server", code: "server" } })}`,
			"data: [DONE]",
		]);
	});

	it("returns the chat iterator when a streaming client disconnects", async () => {
		let closed = false;
		const chat: LlmChatAdapter = {
			async *chat() {
				try {
					yield model;
					yield { type: "text", text: "a" };
					yield { type: "text", text: "b" };
					yield finish;
				} finally {
					closed = true;
				}
			},
		};
		const a = createGatewayApp({ chat, models: async () => [], token: TOKEN });
		const res = await post(a, { body: body({ stream: true }) });
		const reader = res.body?.getReader();
		await reader?.read();
		expect(closed).toBe(false);
		await reader?.cancel();
		expect(closed).toBe(true);
	});

	it("answers 400 for a bad body, a bad model or a missing run id", async () => {
		const { app: a, asked } = app([model, finish]);
		expect((await post(a, { body: "{not json" })).status).toBe(400);
		expect((await post(a, { body: body({ messages: [] }) })).status).toBe(400);
		expect((await post(a, { body: body({ model: "nope" }) })).status).toBe(400);
		const { "x-mete-run-id": _, ...noRun } = headers();
		expect((await post(a, { headers: noRun })).status).toBe(400);
		expect(
			(await post(a, { headers: headers({ "x-mete-priority": "7" }) })).status,
		).toBe(400);
		expect(asked).toHaveLength(0);
	});
});

describe("serveGateway", () => {
	it("listens on 127.0.0.1 on a free port until closed", async () => {
		const { chat } = fakeChat([model, finish]);
		const server = await serveGateway({
			chat,
			models: async () => [],
			token: TOKEN,
		});
		try {
			expect(server.port).toBeGreaterThan(0);
			const res = await fetch(`http://127.0.0.1:${server.port}/v1/models`, {
				headers: headers(),
			});
			expect(res.status).toBe(200);
		} finally {
			await server.close();
		}
		await expect(
			fetch(`http://127.0.0.1:${server.port}/v1/models`),
		).rejects.toThrow();
	});
});
