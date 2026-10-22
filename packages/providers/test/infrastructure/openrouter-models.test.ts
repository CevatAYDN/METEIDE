import { describe, expect, it } from "vitest";
import { listOpenRouterModels } from "../../src/infrastructure/openrouter-models.js";

// A hand-written fake of OpenRouter's GET /models; no test reaches the network.
const fake: typeof fetch = async () =>
	Response.json({
		data: [
			{
				id: "openai/gpt-x",
				context_length: 128_000,
				pricing: { prompt: "0.00000015", completion: "0.0000006" },
			},
			{
				id: "meta/llama:free",
				context_length: 64_000,
				pricing: { prompt: "0", completion: "0" },
			},
			{ id: "odd/model", pricing: { prompt: "n/a", completion: "1" } },
		],
	});

describe("OpenRouter models (ADR-042)", () => {
	it("turns per-token pricing into US dollars per million tokens for paid models only", async () => {
		const r = await listOpenRouterModels(
			"https://openrouter.ai/api/v1/models",
			"k",
			new AbortController().signal,
			{
				fetch: fake,
				now: 0,
			},
		);
		if (!r.ok) throw new Error(r.error.message);
		const [paid, free, odd] = r.value;
		expect(paid?.price?.input).toBeCloseTo(0.15);
		expect(paid?.price?.output).toBeCloseTo(0.6);
		expect(free?.price).toBeUndefined();
		expect(odd?.price).toBeUndefined();
	});
});
