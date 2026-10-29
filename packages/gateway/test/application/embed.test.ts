import { err, type LlmEmbedRequest, ok } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import { createLlmEmbed } from "../../src/application/embed.js";
import {
	deps,
	failure,
	fakeEmbedder,
	fakeQuota,
	offer,
	RUN,
	vectors,
} from "./fakes.js";

// The llm.embed@1 pipeline over fake embedders and a fake pool (docs/09, Gateway; ADR-152).

const req: LlmEmbedRequest = {
	input: ["a cup", "sk-1"],
	purpose: "query",
	runId: RUN,
	priority: 2,
};
const signal = () => new AbortController().signal;
const masked = {
	mask: async (t: string) => ({ text: t.replace("sk-1", "[key]"), masked: 1 }),
};
const training = { trains: true, logs: true, publishes: false } as const;

describe("llm.embed@1", () => {
	it("embeds the masked input at the caller's priority, settles the estimate and logs the call", async () => {
		const e = fakeEmbedder("a", [ok(vectors(2))]);
		const q = fakeQuota();
		const offered = [offer(e.adapter, "emb")];
		const { deps: d, calls } = deps({
			discover: async () => offered,
			quota: q.quota,
			mask: masked,
		});
		const r = await createLlmEmbed(d).embed(req, signal());
		const model = { providerId: "a", modelId: "emb" };
		expect(r).toEqual(ok({ ...vectors(2), model }));
		const input = ["a cup", "[key]"];
		expect(e.seen).toEqual([{ model: "emb", input, purpose: "query" }]);
		// 10 characters over 4, rounded up; an embedding reports no usage, so the estimate settles.
		expect(q.reserved).toEqual([
			{
				runId: RUN,
				priority: 2,
				chain: [model],
				estimate: { tokens_per_minute: 3 },
			},
		]);
		expect(q.settled).toEqual([
			{ id: "r1", actual: { tokens_per_minute: 3 }, observations: [] },
		]);
		expect(calls).toMatchObject([
			{
				runId: RUN,
				...model,
				tier: null,
				request: { input, purpose: "query" },
			},
		]);
		expect(calls[0]?.outcome).toBe("stop");
	});

	it("leaves out a provider that trains unless training is allowed (ADR-152)", async () => {
		const e = fakeEmbedder("nvidia", [ok(vectors(2))]);
		const offered = [{ ...offer(e.adapter, "emb"), privacy: training }];
		const discover = async () => offered;
		const denied = deps({ discover, quota: fakeQuota().quota });
		const no = await createLlmEmbed(denied.deps).embed(req, signal());
		expect(no.ok ? "ok" : no.error.code).toBe("no_model");
		const allowed = deps({
			discover,
			quota: fakeQuota().quota,
			rules: () => ({ allowTraining: true, sensitive: false }),
		});
		const yes = await createLlmEmbed(allowed.deps).embed(req, signal());
		expect(yes.ok).toBe(true);
	});

	it("tries free models before paid ones, and a paid entry carries its cost (ADR-042)", async () => {
		const e = fakeEmbedder("a", [ok(vectors(2))]);
		const free = offer(e.adapter, "free");
		const base = offer(e.adapter, "paid");
		const price = { input: 1, output: 0 };
		const paid = { ...base, model: { ...base.model, free: false, price } };
		const q = fakeQuota();
		const { deps: d } = deps({
			discover: async () => [paid, free],
			quota: q.quota,
			rules: () => ({ allowTraining: false, sensitive: false, mode: "both" }),
		});
		await createLlmEmbed(d).embed(req, signal());
		expect(q.reserved[0]?.chain).toEqual([
			{ providerId: "a", modelId: "free" },
			{ providerId: "a", modelId: "paid", estimate: { usd_per_day: 3e-6 } },
		]);
	});

	it("moves past a refused key, logs both calls and leaves that model out of later calls", async () => {
		const a = fakeEmbedder("a", [err(failure(401))]);
		const b = fakeEmbedder("b", [ok(vectors(2))]);
		const q = fakeQuota();
		const offered = [offer(a.adapter, "emb"), offer(b.adapter, "emb")];
		const { deps: d, calls } = deps({
			discover: async () => offered,
			quota: q.quota,
		});
		const embed = createLlmEmbed(d);
		const first = await embed.embed(req, signal());
		expect(first.ok && first.value.model.providerId).toBe("b");
		expect(calls.map((c) => c.outcome)).toEqual(["unauthorized", "stop"]);
		// The refused call still counts one request.
		expect(q.settled[0]?.actual).toEqual({});
		await embed.embed(req, signal());
		expect(q.reserved[2]?.chain.map((c) => c.providerId)).toEqual(["b"]);
	});

	it("waits after a rate limit and tries the same model again", async () => {
		const a = fakeEmbedder("a", [err(failure(429)), ok(vectors(2))]);
		const { deps: d, waits } = deps({
			discover: async () => [offer(a.adapter, "emb")],
			quota: fakeQuota().quota,
		});
		const r = await createLlmEmbed(d).embed(req, signal());
		expect(r.ok).toBe(true);
		expect(waits).toEqual([2000]);
		expect(a.seen).toHaveLength(2);
	});
});
