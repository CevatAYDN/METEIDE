import type { ModelInfo } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import {
	createOpenRouterModule,
	OPENROUTER,
} from "../../src/providers/openrouter.js";

const NOW = Date.parse("2026-10-21T12:00:00Z");

const model = (over: Record<string, unknown>) => ({
	id: "minimax/minimax-m3.1-flash:free",
	name: "MiniMax M3.1 Flash (free)",
	context_length: 1_000_000,
	architecture: {
		input_modalities: ["text", "image"],
		output_modalities: ["text"],
	},
	pricing: { prompt: "0", completion: "0" },
	supported_parameters: ["max_tokens", "tools", "temperature"],
	expiration_date: null,
	...over,
});

// Answers like OpenRouter; no test reaches the real provider.
const routerFetch =
	(sent: Record<string, unknown>[], seen: string[]) =>
	async (url: RequestInfo | URL, init?: RequestInit) => {
		const u = String(url);
		seen.push(u);
		if (u.endsWith("/models"))
			return Response.json({
				data: [
					model({}),
					model({
						id: "acme/old:free",
						supported_parameters: [],
						architecture: { input_modalities: ["text"] },
						expiration_date: "2026-10-01",
					}),
					model({
						id: "acme/paid",
						pricing: { prompt: "0.000001", completion: "0" },
					}),
				],
			});
		sent.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
		const chunk = {
			id: "c",
			object: "chat.completion.chunk",
			created: 0,
			model: "m",
			choices: [{ index: 0, delta: { content: "ok" }, finish_reason: "stop" }],
			usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
		};
		return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
			headers: { "content-type": "text/event-stream" },
		});
	};

const adapter = (sent: Record<string, unknown>[] = [], seen: string[] = []) =>
	OPENROUTER.build({
		apiKey: "k",
		models: {},
		fetch: routerFetch(sent, seen),
		now: () => NOW,
	});

describe("OpenRouter", () => {
	it("lists models from metadata: tools, images, free ids and expired models", async () => {
		const seen: string[] = [];
		const r = await adapter([], seen).listModels(new AbortController().signal);
		expect(seen).toEqual(["https://openrouter.ai/api/v1/models"]);
		expect(r.ok && r.value).toEqual([
			{
				id: "minimax/minimax-m3.1-flash:free",
				providerId: "openrouter",
				family: "minimax",
				contextWindow: 1_000_000,
				toolCalling: true,
				vision: true,
				free: true,
				deprecated: false,
			},
			{
				id: "acme/old:free",
				providerId: "openrouter",
				family: "acme",
				contextWindow: 1_000_000,
				toolCalling: false,
				vision: false,
				free: true,
				deprecated: true,
			},
			{
				id: "acme/paid",
				providerId: "openrouter",
				family: "acme",
				contextWindow: 1_000_000,
				toolCalling: true,
				vision: true,
				free: false,
				deprecated: false,
			},
		]);
	});

	it("lets a user row override the metadata of one model", async () => {
		const a = OPENROUTER.build({
			apiKey: "k",
			models: {
				"acme/paid": {
					capability: "chat",
					contextWindow: 8_000,
					toolCalling: false,
					vision: false,
					free: true,
					family: "mine",
				},
			},
			fetch: routerFetch([], []),
			now: () => NOW,
		});
		const r = await a.listModels(new AbortController().signal);
		const paid = r.ok ? r.value.find((m) => m.id === "acme/paid") : undefined;
		expect(paid).toMatchObject({
			family: "mine",
			contextWindow: 8_000,
			toolCalling: false,
			free: true,
			deprecated: false,
		});
	});

	it("asks OpenRouter to route only to providers that do not collect data", async () => {
		const sent: Record<string, unknown>[] = [];
		const a = adapter(sent);
		for await (const _ of a.chat(
			{ model: "m", messages: [{ role: "user", content: "hi" }] },
			new AbortController().signal,
		));
		expect(sent[0]?.provider).toEqual({ data_collection: "deny" });
	});

	it("closes a unit only for OpenRouter's own 429, picking the unit by its limit", () => {
		const a = adapter();
		const platform = (limit: string, retry?: string) =>
			new Headers({
				"x-ratelimit-limit": limit,
				"x-ratelimit-remaining": "0",
				"x-ratelimit-reset": "1792584000000",
				...(retry === undefined ? {} : { "retry-after": retry }),
			});
		expect(a.observe(429, platform("50", "60"))).toEqual([
			{
				unit: "requests_per_day",
				limit: 50,
				exhausted: true,
				resetsAt: "2026-10-21T12:01:00.000Z",
			},
		]);
		expect(a.observe(429, platform("1000"))).toEqual([
			{ unit: "requests_per_day", limit: 1000, exhausted: true },
		]);
		expect(a.observe(429, platform("20"))).toEqual([
			{ unit: "requests_per_minute", limit: 20, exhausted: true },
		]);
		expect(a.observe(429, new Headers({ "retry-after": "5" }))).toEqual([]);
		expect(a.observe(200, platform("20"))).toEqual([]);
		expect(a.observe(429, platform("lots"))).toEqual([]);
	});

	it("ships the documented free-model limits and its privacy with data_collection deny", () => {
		const a = adapter();
		expect(a.quotaUnits()).toEqual([
			{
				providerId: "openrouter",
				unit: "requests_per_minute",
				limit: 20,
				scope: "account",
				reset: "sliding",
			},
			{
				providerId: "openrouter",
				unit: "requests_per_day",
				limit: 50,
				scope: "account",
				reset: "fixed_daily",
			},
		]);
		expect(a.privacy({ id: "x" } as ModelInfo)).toEqual({
			trains: false,
			logs: "unknown",
			publishes: false,
		});
		expect(createOpenRouterModule().manifest.id).toBe("provider-openrouter");
	});
});
