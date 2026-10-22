import type { ChatChunk, ModelInfo } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import type { ModelRow } from "../../src/domain/model-data.js";
import { createGoogleModule, GOOGLE } from "../../src/providers/google.js";

const NOW = Date.parse("2026-10-22T12:00:00Z");

const row: ModelRow = {
	capability: "chat",
	contextWindow: 1_048_576,
	toolCalling: true,
	vision: false,
	free: true,
	family: "gemini",
	privacy: { trains: true, logs: true, publishes: false },
};

// Answers like the Gemini API's OpenAI-compatible endpoints; no test reaches the real provider.
const googleFetch =
	(seen: { url: string; auth: string | null; model?: string }[]) =>
	async (url: RequestInfo | URL, init?: RequestInit) => {
		const u = String(url);
		const body =
			typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
		seen.push({
			url: u,
			auth: new Headers(init?.headers).get("authorization"),
			model: body?.model,
		});
		if (u.endsWith("/openai/models"))
			return Response.json({
				object: "list",
				data: [{ id: "models/gemini-2.5-flash" }, { id: "models/brand-new" }],
			});
		const chunk = {
			id: "c",
			object: "chat.completion.chunk",
			created: 0,
			model: "gemini-2.5-flash",
			choices: [{ index: 0, delta: { content: "ok" }, finish_reason: "stop" }],
			usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
		};
		return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
			headers: { "content-type": "text/event-stream" },
		});
	};

type Seen = { url: string; auth: string | null; model?: string }[];

const adapter = (seen: Seen = []) =>
	GOOGLE.build({
		apiKey: "k",
		models: { "gemini-2.5-flash": row },
		fetch: googleFetch(seen),
		now: () => NOW,
	});

describe("Google AI Studio", () => {
	it("lists models without the models/ prefix, with facts from models.yaml", async () => {
		const seen: Seen = [];
		const r = await adapter(seen).listModels(new AbortController().signal);
		expect(seen.map((s) => s.url)).toEqual([
			"https://generativelanguage.googleapis.com/v1beta/openai/models",
		]);
		expect(seen[0]?.auth).toBe("Bearer k");
		const models = r.ok ? r.value : [];
		expect(models.map((m) => [m.id, m.contextWindow, m.free])).toEqual([
			["gemini-2.5-flash", 1_048_576, true],
			["brand-new", 0, false],
		]);
	});

	it("chats through the chat completions endpoint with the plain model id", async () => {
		const seen: Seen = [];
		const out: ChatChunk[] = [];
		for await (const c of adapter(seen).chat(
			{
				model: "gemini-2.5-flash",
				messages: [{ role: "user", content: "hi" }],
			},
			new AbortController().signal,
		))
			out.push(c);
		expect(seen.map((s) => [s.url, s.model])).toEqual([
			[
				"https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
				"gemini-2.5-flash",
			],
		]);
		expect(out.at(-1)).toMatchObject({ type: "finish", reason: "stop" });
	});

	it("learns its limits from 429s", () => {
		const a = adapter();
		expect(a.quotaUnits()).toEqual([
			{
				providerId: "google",
				unit: "requests_per_minute",
				limit: "discover",
				scope: "account",
				reset: "sliding",
			},
		]);
		expect(a.observe(429, new Headers())).toEqual([
			{ unit: "requests_per_minute", exhausted: true },
		]);
	});

	it("takes privacy from the model row, which says it trains on free prompts", () => {
		const a = adapter();
		const info = (id: string) => ({ id }) as ModelInfo;
		expect(a.privacy(info("gemini-2.5-flash"))).toEqual(row.privacy);
		expect(a.privacy(info("brand-new"))).toEqual({
			trains: "unknown",
			logs: "unknown",
			publishes: "unknown",
		});
	});

	it("is the provider-google module serving provider.chat@2", () => {
		expect(GOOGLE.moduleId).toBe("provider-google");
		expect(createGoogleModule().manifest).toMatchObject({
			id: "provider-google",
			provides: ["provider.chat@2"],
			permissions: ["net", "secrets"],
		});
	});
});
