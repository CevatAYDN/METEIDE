import type { ChatChunk, ModelInfo } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import type { ModelRow } from "../../src/domain/model-data.js";
import {
	createOpenCodeZenModule,
	OPENCODE_ZEN,
} from "../../src/providers/opencode-zen.js";

const NOW = Date.parse("2026-10-21T12:00:00Z");

const row: ModelRow = {
	capability: "chat",
	contextWindow: 200_000,
	toolCalling: true,
	vision: false,
	free: true,
	family: "big-pickle",
	privacy: { trains: true, logs: true, publishes: false },
};

// Answers like the Zen endpoints; no test reaches the real provider.
const zenFetch = (seen: string[]) => async (url: RequestInfo | URL) => {
	const u = String(url);
	seen.push(u);
	if (u.endsWith("/inference/v1/models"))
		return Response.json({
			object: "list",
			data: [{ id: "big-pickle" }, { id: "brand-new-free" }],
		});
	const chunk = {
		id: "c",
		object: "chat.completion.chunk",
		created: 0,
		model: "big-pickle",
		choices: [{ index: 0, delta: { content: "ok" }, finish_reason: "stop" }],
		usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
	};
	return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
		headers: { "content-type": "text/event-stream" },
	});
};

const adapter = (seen: string[] = []) =>
	OPENCODE_ZEN.build({
		apiKey: "k",
		models: { "big-pickle": row },
		fetch: zenFetch(seen),
		now: () => NOW,
	});

describe("OpenCode Zen", () => {
	it("lists models from the Zen endpoint with facts from models.yaml", async () => {
		const seen: string[] = [];
		const r = await adapter(seen).listModels(new AbortController().signal);
		expect(seen).toEqual(["https://opencode.ai/inference/v1/models"]);
		const models = r.ok ? r.value : [];
		expect(models.map((m) => [m.id, m.contextWindow, m.free])).toEqual([
			["big-pickle", 200_000, true],
			["brand-new-free", 0, false],
		]);
	});

	it("chats through the Zen chat completions endpoint", async () => {
		const seen: string[] = [];
		const out: ChatChunk[] = [];
		const a = adapter(seen);
		for await (const c of a.chat(
			{ model: "big-pickle", messages: [{ role: "user", content: "hi" }] },
			new AbortController().signal,
		))
			out.push(c);
		expect(seen).toEqual([
			"https://opencode.ai/inference/openai/v1/chat/completions",
		]);
		expect(out.at(-1)).toMatchObject({ type: "finish", reason: "stop" });
	});

	it("learns its minute limit from 429s and reads Retry-After", () => {
		const a = adapter();
		expect(a.quotaUnits()).toEqual([
			{
				providerId: "opencode-zen",
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
				resetsAt: "2026-10-21T12:00:20.000Z",
			},
		]);
		expect(a.observe(429, new Headers())).toEqual([
			{ unit: "requests_per_minute", exhausted: true },
		]);
		expect(a.observe(200, new Headers())).toEqual([]);
		expect(a.observe(500, new Headers())).toEqual([]);
	});

	it("takes privacy from the model row and is unknown without one", () => {
		const a = adapter();
		const info = (id: string) => ({ id }) as ModelInfo;
		expect(a.privacy(info("big-pickle"))).toEqual(row.privacy);
		expect(a.privacy(info("brand-new-free"))).toEqual({
			trains: "unknown",
			logs: "unknown",
			publishes: "unknown",
		});
	});

	it("is the provider-opencode-zen module serving provider.chat@1", () => {
		expect(OPENCODE_ZEN.moduleId).toBe("provider-opencode-zen");
		expect(OPENCODE_ZEN.provides).toEqual(["provider.chat@1"]);
		expect(createOpenCodeZenModule().manifest).toMatchObject({
			id: "provider-opencode-zen",
			provides: ["provider.chat@1"],
			permissions: ["net", "secrets"],
		});
	});
});
