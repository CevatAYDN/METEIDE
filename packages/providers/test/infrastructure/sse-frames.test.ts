import type { ChatChunk } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import { createOpenAIChat } from "../../src/infrastructure/openai-chat.js";

// Event streams as an endpoint sent them, byte for byte; tests never call a real provider (AGENTS.md).
const chunk = (id: string, delta: unknown, finish: string | null = null) =>
	`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n`;

const call = {
	tool_calls: [
		{
			index: 0,
			id: "call_1",
			type: "function",
			function: { name: "fs_read", arguments: '{"path":"README.md"}' },
		},
	],
};

// What a custom endpoint answered on 2026-10-29: a second completion after the finish, glued to [DONE].
const glued = [
	chunk("a", { content: "Çalışma saat" }),
	"\n",
	chunk("a", call),
	"\n",
	chunk("a", {}, "stop"),
	"\n",
	chunk("b", { role: "assistant", content: "leri ekliyorum." }),
	"data: [DONE]\n\n",
].join("");

const chatOver = (body: string) =>
	createOpenAIChat({
		name: "test",
		baseURL: "https://provider.test/v1",
		apiKey: "k",
		fetch: async () =>
			new Response(body, { headers: { "content-type": "text/event-stream" } }),
	});

const collect = async (body: string) => {
	const out: ChatChunk[] = [];
	const req = {
		model: "m",
		messages: [{ role: "user" as const, content: "hi" }],
	};
	for await (const c of chatOver(body).chat(req, new AbortController().signal))
		out.push(c);
	return out;
};

describe("openai chat: event stream frames", () => {
	it("reads data lines an endpoint glued together as separate events", async () => {
		expect(await collect(glued)).toEqual([
			{ type: "text", text: "Çalışma saat" },
			{ type: "text", text: "leri ekliyorum." },
			// The SDK hands over streamed tool calls when the stream ends.
			{
				type: "tool-call",
				id: "call_1",
				name: "fs_read",
				args: { path: "README.md" },
			},
			{ type: "finish", reason: "stop", usage: { prompt: 0, completion: 0 } },
		]);
	});

	it("keeps an error event with its data line", async () => {
		const failed =
			'event: error\ndata: {"error":{"message":"upstream ended"}}\n\n';
		expect(await collect(failed)).toEqual([
			{ type: "error", error: { code: "server", message: "upstream ended" } },
		]);
	});
});
