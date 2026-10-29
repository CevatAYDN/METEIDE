import { type CapabilityRef, ok, type ProviderAdapter } from "@mete/contracts";
import {
	createCapabilityRegistry,
	createConfigReader,
	createEventBus,
	type ModuleContext,
} from "@mete/kernel";
import {
	type ProviderScenario,
	providerChatContract,
	providerEmbedContract,
} from "@mete/testing";
import type { ProviderDefinition } from "../src/application/provider-module.js";
import { createCustomModule } from "../src/providers/custom.js";
import { GOOGLE } from "../src/providers/google.js";
import { GROQ } from "../src/providers/groq.js";
import { NVIDIA } from "../src/providers/nvidia.js";
import { OPENCODE_ZEN } from "../src/providers/opencode-zen.js";
import { OPENROUTER } from "../src/providers/openrouter.js";

// Runs the provider.chat@2 kit against every adapter, each behind a fake endpoint in
// its own wire format; no test reaches a real provider.

const NOW = Date.parse("2026-10-21T12:00:00Z");

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

const tooMany = () =>
	new Response(JSON.stringify({ error: { message: "rate limited" } }), {
		status: 429,
		headers: { "content-type": "application/json", "retry-after": "3" },
	});

const openaiStream = () =>
	sse([
		{
			id: "c",
			object: "chat.completion.chunk",
			created: 0,
			model: "m",
			choices: [
				{
					index: 0,
					delta: { role: "assistant", content: "hi" },
					finish_reason: null,
				},
			],
		},
		{
			id: "c",
			object: "chat.completion.chunk",
			created: 0,
			model: "m",
			choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
			usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
		},
	]);

const anthropicStream = () =>
	sse(
		[
			{
				type: "message_start",
				message: {
					id: "msg",
					type: "message",
					role: "assistant",
					model: "m",
					content: [],
					stop_reason: null,
					usage: { input_tokens: 2, output_tokens: 1 },
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
				delta: { type: "text_delta", text: "hi" },
			},
			{ type: "content_block_stop", index: 0 },
			{
				type: "message_delta",
				delta: { stop_reason: "end_turn" },
				usage: { output_tokens: 1 },
			},
			{ type: "message_stop" },
		],
		true,
	);

const googleStream = () =>
	sse([
		{
			candidates: [
				{
					content: { role: "model", parts: [{ text: "hi" }] },
					finishReason: "STOP",
					index: 0,
				},
			],
			usageMetadata: {
				promptTokenCount: 2,
				candidatesTokenCount: 1,
				totalTokenCount: 3,
			},
		},
	]);

// One fake endpoint: model lists answer in every format, chat follows the scenario.
const fakeFetch =
	(scenario: ProviderScenario, stream: () => Response) =>
	async (url: RequestInfo | URL) => {
		const u = String(url);
		if (/\/models(\?|$)/.test(u))
			return Response.json({
				data: [{ id: "m" }],
				models: [
					{ name: "models/m", supportedGenerationMethods: ["generateContent"] },
				],
			});
		return scenario === "rate-limited" ? tooMany() : stream();
	};

const builtIn = (def: ProviderDefinition) =>
	providerChatContract(def.displayName, async (scenario) => ({
		adapter: def.build({
			apiKey: "k",
			models: {},
			fetch: fakeFetch(scenario, openaiStream),
			now: () => NOW,
		}),
		model: "m",
		close: async () => {},
	}));

builtIn(NVIDIA);
builtIn(OPENROUTER);
builtIn(OPENCODE_ZEN);
builtIn(GROQ);
builtIn(GOOGLE);

// One custom endpoint "lab" in the given format, its adapter under `capability`.
const openCustom = async (
	format: string,
	fetch: typeof globalThis.fetch,
	capability: CapabilityRef,
	models: unknown = {},
) => {
	const registry = createCapabilityRegistry(() => []);
	const log = () => {};
	const ctx: ModuleContext = {
		capabilities: registry,
		events: createEventBus((e) => {
			throw e;
		}),
		config: createConfigReader({
			global: {
				file: "settings.yaml",
				sections: {
					providers: {
						custom: [
							{
								slug: "lab",
								name: "Lab",
								baseUrl: "https://lab.test/v1",
								format,
							},
						],
					},
					models,
				},
			},
			workspace: {},
		}),
		logger: { error: log, warn: log, info: log, debug: log },
		disposables: { add: () => {}, dispose: () => {} },
		secrets: {
			get: async () => ok("k"),
			set: async () => ok(undefined),
			delete: async () => ok(false),
		},
	};
	const module = createCustomModule({ fetch, now: () => NOW });
	await module.activate(ctx);
	const r = registry.resolve<ProviderAdapter>(capability);
	if (!r.ok || !r.value[0]) throw new Error("no custom adapter");
	return { adapter: r.value[0].impl, close: () => module.deactivate() };
};

const custom = (format: string, stream: () => Response) =>
	providerChatContract(`custom ${format}`, async (scenario) => ({
		...(await openCustom(
			format,
			fakeFetch(scenario, stream),
			"provider.chat@2",
		)),
		model: "m",
	}));

custom("openai-chat", openaiStream);
custom("anthropic-messages", anthropicStream);
custom("google-gemini", googleStream);

// The provider.embed@2 kit: an embedding endpoint in the OpenAI shape NVIDIA shares, and
// a row that names model "e" as an embedding model.
const EMBED_ROW = {
	capability: "embed",
	contextWindow: 8_192,
	toolCalling: false,
	vision: false,
	free: true,
	family: "e",
} as const;

const embedFetch =
	(scenario: ProviderScenario) =>
	async (url: RequestInfo | URL, init?: RequestInit) => {
		if (/\/models(\?|$)/.test(String(url)))
			return Response.json({ data: [{ id: "e" }, { id: "m" }] });
		if (scenario === "rate-limited") return tooMany();
		const { input } = JSON.parse(String(init?.body)) as { input: string[] };
		return Response.json({
			object: "list",
			model: "e",
			data: input.map((_, index) => ({
				object: "embedding",
				index,
				embedding: [index, 0.5],
			})),
			usage: { prompt_tokens: 2, total_tokens: 2 },
		});
	};

providerEmbedContract(NVIDIA.displayName, async (scenario) => ({
	adapter: NVIDIA.build({
		apiKey: "k",
		models: { e: EMBED_ROW },
		fetch: embedFetch(scenario),
		now: () => NOW,
	}),
	model: "e",
	close: async () => {},
}));

providerEmbedContract("custom openai-chat", async (scenario) => ({
	...(await openCustom(
		"openai-chat",
		embedFetch(scenario),
		"provider.embed@2",
		{ "custom:lab": { e: EMBED_ROW } },
	)),
	model: "e",
}));
