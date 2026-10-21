import type { ModelInfo } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import type { ModelRow } from "../../src/domain/model-data.js";
import { createNvidiaModule, NVIDIA } from "../../src/providers/nvidia.js";

const NOW = Date.parse("2026-10-21T12:00:00Z");

const row = (capability: ModelRow["capability"]): ModelRow => ({
	capability,
	contextWindow: 262_144,
	toolCalling: capability === "chat",
	vision: false,
	free: true,
	family: "kimi",
});

type Sent = { url: string; body: unknown };

// Answers like NVIDIA's endpoints; no test reaches the real provider.
const nvidiaFetch =
	(sent: Sent[], rankings?: unknown) =>
	async (url: RequestInfo | URL, init?: RequestInit) => {
		const u = String(url);
		sent.push({
			url: u,
			body: init?.body ? JSON.parse(String(init.body)) : undefined,
		});
		if (u.endsWith("/models"))
			return Response.json({
				data: [
					{ id: "moonshotai/kimi-k2.6" },
					{ id: "nvidia/embedder" },
					{ id: "x/new" },
				],
			});
		if (u.endsWith("/embeddings"))
			return Response.json({
				data: [
					{ index: 1, embedding: [0.2] },
					{ index: 0, embedding: [0.1] },
				],
			});
		return Response.json({
			rankings: rankings ?? [
				{ index: 2, logit: 4.5 },
				{ index: 0, logit: -1.7 },
				{ index: 1, logit: -5.1 },
			],
		});
	};

const adapter = (sent: Sent[], rankings?: unknown) =>
	NVIDIA.build({
		apiKey: "nvapi-k",
		models: {
			"moonshotai/kimi-k2.6": row("chat"),
			"nvidia/embedder": row("embed"),
		},
		fetch: nvidiaFetch(sent, rankings),
		now: () => NOW,
	});

const signal = () => new AbortController().signal;

describe("NVIDIA", () => {
	it("lists only chat models, failing closed for ids without a row", async () => {
		const r = await adapter([]).listModels(signal());
		expect(r.ok && r.value.map((m) => [m.id, m.contextWindow])).toEqual([
			["moonshotai/kimi-k2.6", 262_144],
			["x/new", 0],
		]);
	});

	it("embeds with input_type from the purpose and returns vectors in input order", async () => {
		const sent: Sent[] = [];
		const a = adapter(sent);
		const r = await a.embed?.(
			{ model: "nvidia/embedder", input: ["a", "b"], purpose: "document" },
			signal(),
		);
		expect(r).toEqual({ ok: true, value: { vectors: [[0.1], [0.2]] } });
		expect(sent[0]).toEqual({
			url: "https://integrate.api.nvidia.com/v1/embeddings",
			body: {
				model: "nvidia/embedder",
				input: ["a", "b"],
				input_type: "passage",
				encoding_format: "float",
			},
		});
		await a.embed?.(
			{ model: "nvidia/embedder", input: ["q"], purpose: "query" },
			signal(),
		);
		expect(sent[1]?.body).toMatchObject({ input_type: "query" });
	});

	it("reranks on the retrieval endpoint and returns scores in document order", async () => {
		const sent: Sent[] = [];
		const r = await adapter(sent).rerank?.(
			{ model: "nvidia/reranker", query: "q", documents: ["a", "b", "c"] },
			signal(),
		);
		expect(r).toEqual({ ok: true, value: { scores: [-1.7, -5.1, 4.5] } });
		expect(sent[0]).toEqual({
			url: "https://ai.api.nvidia.com/v1/retrieval/nvidia/reranker/reranking",
			body: {
				model: "nvidia/reranker",
				query: { text: "q" },
				passages: [{ text: "a" }, { text: "b" }, { text: "c" }],
			},
		});
	});

	it("ranks a passage the answer leaves out last and ignores stray indexes", async () => {
		const r = await adapter(
			[],
			[
				{ index: 0, logit: 1 },
				{ index: 7, logit: 9 },
			],
		).rerank?.({ model: "m", query: "q", documents: ["a", "b"] }, signal());
		expect(r).toEqual({
			ok: true,
			value: { scores: [1, Number.NEGATIVE_INFINITY] },
		});
	});

	it("has a 40-a-minute limit, closes it on 429 and reports the trial terms' privacy", () => {
		const a = adapter([]);
		expect(a.quotaUnits()).toEqual([
			{
				providerId: "nvidia",
				unit: "requests_per_minute",
				limit: 40,
				scope: "account",
				reset: "sliding",
			},
		]);
		expect(a.observe(429, new Headers())).toEqual([
			{ unit: "requests_per_minute", exhausted: true },
		]);
		expect(a.privacy({ id: "x" } as ModelInfo)).toEqual({
			trains: true,
			logs: true,
			publishes: false,
		});
		expect(createNvidiaModule().manifest).toMatchObject({
			id: "provider-nvidia",
			provides: ["provider.chat@1", "provider.embed@1", "provider.rerank@1"],
		});
	});
});
