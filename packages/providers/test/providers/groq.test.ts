import type { ChatChunk, ModelInfo } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import type { ModelRow } from "../../src/domain/model-data.js";
import { createGroqModule, GROQ } from "../../src/providers/groq.js";

const NOW = Date.parse("2026-10-22T12:00:00Z");

const row: ModelRow = {
	capability: "chat",
	contextWindow: 131_072,
	toolCalling: true,
	vision: false,
	free: true,
	family: "gpt-oss",
	privacy: { trains: false, logs: true, publishes: false },
};

// Answers like Groq's endpoints; no test reaches the real provider.
const groqFetch =
	(seen: { url: string; auth: string | null }[]) =>
	async (url: RequestInfo | URL, init?: RequestInit) => {
		const u = String(url);
		seen.push({
			url: u,
			auth: new Headers(init?.headers).get("authorization"),
		});
		if (u.endsWith("/openai/v1/models"))
			return Response.json({
				object: "list",
				data: [{ id: "openai/gpt-oss-120b" }, { id: "brand-new-model" }],
			});
		const chunk = {
			id: "c",
			object: "chat.completion.chunk",
			created: 0,
			model: "openai/gpt-oss-120b",
			choices: [{ index: 0, delta: { content: "ok" }, finish_reason: "stop" }],
			usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
		};
		return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
			headers: { "content-type": "text/event-stream" },
		});
	};

const adapter = (seen: { url: string; auth: string | null }[] = []) =>
	GROQ.build({
		apiKey: "k",
		models: { "openai/gpt-oss-120b": row },
		fetch: groqFetch(seen),
		now: () => NOW,
	});

describe("Groq", () => {
	it("lists models from Groq's endpoint with facts from models.yaml", async () => {
		const seen: { url: string; auth: string | null }[] = [];
		const r = await adapter(seen).listModels(new AbortController().signal);
		expect(seen.map((s) => s.url)).toEqual([
			"https://api.groq.com/openai/v1/models",
		]);
		expect(seen[0]?.auth).toBe("Bearer k");
		const models = r.ok ? r.value : [];
		expect(models.map((m) => [m.id, m.contextWindow, m.free])).toEqual([
			["openai/gpt-oss-120b", 131_072, true],
			["brand-new-model", 0, false],
		]);
	});

	it("chats through the chat completions endpoint", async () => {
		const seen: { url: string; auth: string | null }[] = [];
		const out: ChatChunk[] = [];
		for await (const c of adapter(seen).chat(
			{
				model: "openai/gpt-oss-120b",
				messages: [{ role: "user", content: "hi" }],
			},
			new AbortController().signal,
		))
			out.push(c);
		expect(seen.map((s) => s.url)).toEqual([
			"https://api.groq.com/openai/v1/chat/completions",
		]);
		expect(out.at(-1)).toMatchObject({ type: "finish", reason: "stop" });
	});

	it("learns its limits from 429s instead of trusting a published number", () => {
		const a = adapter();
		expect(a.quotaUnits()).toEqual([
			{
				providerId: "groq",
				unit: "requests_per_minute",
				limit: "discover",
				scope: "account",
				reset: "sliding",
			},
		]);
		expect(a.observe(429, new Headers({ "retry-after": "20" }))).toEqual([
			{
				unit: "requests_per_minute",
				exhausted: true,
				resetsAt: "2026-10-22T12:00:20.000Z",
			},
		]);
		expect(a.observe(200, new Headers())).toEqual([]);
	});

	it("takes privacy from the model row and is unknown without one", () => {
		const a = adapter();
		const info = (id: string) => ({ id }) as ModelInfo;
		expect(a.privacy(info("openai/gpt-oss-120b"))).toEqual(row.privacy);
		expect(a.privacy(info("brand-new-model"))).toEqual({
			trains: "unknown",
			logs: "unknown",
			publishes: "unknown",
		});
	});

	it("is the provider-groq module serving provider.chat@2", () => {
		expect(GROQ.moduleId).toBe("provider-groq");
		expect(GROQ.provides).toEqual(["provider.chat@2"]);
		expect(createGroqModule().manifest).toMatchObject({
			id: "provider-groq",
			provides: ["provider.chat@2"],
			permissions: ["net", "secrets"],
		});
	});
});
