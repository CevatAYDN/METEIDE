import {
	err,
	type LlmChatRequest,
	ok,
	type QuotaRequest,
} from "@mete/contracts";
import { describe, expect, it } from "vitest";
import { createLlmChat } from "../../src/application/chat.js";
import { ESTIMATED_COMPLETION_TOKENS } from "../../src/defaults.js";
import {
	collect,
	deps,
	done,
	fakeProvider,
	offer,
	RUN,
	text,
} from "./fakes.js";

// The paid estimate without maxTokens and the masking of tool specs (docs/09, Gateway).

const signal = () => new AbortController().signal;

const req: LlmChatRequest = {
	target: { tier: "coder" },
	runId: RUN,
	priority: 1,
	messages: [{ role: "user", content: "hello sk-live" }],
};

// A pool with only the spending cap: an entry whose estimated cost is over `capUsd` is refused.
const cappedQuota = (capUsd: number) => {
	const reserved: QuotaRequest[] = [];
	return {
		reserved,
		quota: {
			define: () => {},
			reserve: async (r: QuotaRequest) => {
				reserved.push(r);
				const hit = r.chain.find(
					(c) => (c.estimate?.usd_per_day ?? 0) <= capUsd,
				);
				return hit
					? ok({ id: "r1", providerId: hit.providerId, modelId: hit.modelId })
					: err({
							code: "quota_exhausted" as const,
							resumesAt: "2026-10-22T00:00:00Z",
						});
			},
			settle: () => ok(undefined),
		},
	};
};

const pricedOffer = () => {
	const paid = fakeProvider("paid", [[text("hi"), done]]);
	const pro = offer(paid.adapter, "pro", 100_000);
	return {
		...pro,
		model: { ...pro.model, free: false, price: { input: 2, output: 10 } },
	};
};

describe("llm.chat@2 paid estimate without maxTokens", () => {
	// "hello sk-live" is 13 characters, 4 prompt tokens at $2 per million.
	const promptUsd = (4 * 2) / 1e6;
	const estimateUsd = promptUsd + (ESTIMATED_COMPLETION_TOKENS * 10) / 1e6;

	it("reserves the documented completion estimate, so a call at the cap edge is refused", async () => {
		const q = cappedQuota(estimateUsd - 1e-9);
		const { deps: d } = deps({
			discover: async () => [pricedOffer()],
			quota: q.quota,
			rules: () => ({ allowTraining: false, sensitive: false, mode: "paid" }),
		});
		const out = await collect(createLlmChat(d).chat(req, signal()));
		expect(q.reserved[0]?.chain).toEqual([
			{
				providerId: "paid",
				modelId: "pro",
				estimate: { usd_per_day: estimateUsd },
			},
		]);
		expect(out.at(-1)).toMatchObject({
			type: "error",
			error: { code: "quota_exhausted" },
		});
	});

	it("is granted when the cap holds the estimate", async () => {
		const q = cappedQuota(estimateUsd);
		const { deps: d } = deps({
			discover: async () => [pricedOffer()],
			quota: q.quota,
			rules: () => ({ allowTraining: false, sensitive: false, mode: "paid" }),
		});
		const out = await collect(createLlmChat(d).chat(req, signal()));
		expect(out.at(-1)).toEqual(done);
	});
});

describe("llm.chat@2 tool specs", () => {
	it("masks tool descriptions like messages, sent and recorded; schemas stay as they are", async () => {
		const a = fakeProvider("a", [[text("hi"), done]]);
		const q = cappedQuota(0);
		const { deps: d, calls } = deps({
			discover: async () => [offer(a.adapter, "m")],
			quota: q.quota,
			mask: {
				mask: async (t) => ({
					text: t.replace("sk-live", "[SECRET:x]"),
					masked: 1,
				}),
			},
		});
		const parameters = {
			type: "object",
			properties: { key: { const: "sk-live" } },
		};
		const tools = [{ name: "t", description: "use sk-live", parameters }];
		await collect(createLlmChat(d).chat({ ...req, tools }, signal()));
		const masked = [{ name: "t", description: "use [SECRET:x]", parameters }];
		expect(a.seen[0]?.tools).toEqual(masked);
		expect(calls[0]?.request).toEqual({
			messages: [{ role: "user", content: "hello [SECRET:x]" }],
			tools: masked,
		});
	});
});
