import type { LlmChatRequest } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import { createLlmChat } from "../../src/application/chat.js";
import {
	collect,
	deps,
	done,
	fakeProvider,
	fakeQuota,
	NOW,
	offer,
	RUN,
	status,
	text,
} from "./fakes.js";

const req: LlmChatRequest = {
	target: { tier: "coder" },
	runId: RUN,
	priority: 1,
	messages: [{ role: "user", content: "hello sk-live" }],
	maxTokens: 10,
};
const signal = () => new AbortController().signal;

describe("llm.chat@1 pipeline", () => {
	it("masks, reserves the chain, streams the first model and settles its usage", async () => {
		const a = fakeProvider("a", [[text("hi"), done]]);
		const q = fakeQuota();
		const { deps: d } = deps({
			discover: async () => [
				offer(a.adapter, "small", 40_000),
				offer(a.adapter, "big", 100_000),
			],
			quota: q.quota,
			mask: {
				mask: async (t) => ({
					text: t.replace("sk-live", "[SECRET:x]"),
					masked: 1,
				}),
			},
		});
		const out = await collect(createLlmChat(d).chat(req, signal()));
		expect(out).toEqual([
			{ type: "model", providerId: "a", modelId: "big", reason: "first" },
			text("hi"),
			done,
		]);
		expect(a.seen[0]).toMatchObject({
			model: "big",
			maxTokens: 10,
			messages: [{ role: "user", content: "hello [SECRET:x]" }],
		});
		expect(q.reserved[0]).toEqual({
			runId: RUN,
			priority: 1,
			chain: [
				{ providerId: "a", modelId: "big" },
				{ providerId: "a", modelId: "small" },
			],
			estimate: { tokens_per_minute: 14 },
		});
		expect(q.settled).toEqual([
			{ id: "r1", actual: { tokens_per_minute: 5 }, observations: [] },
		]);
	});

	it("retries a 429 on the same model after the wait, observing and settling each call", async () => {
		const obs = [{ unit: "requests_per_minute", exhausted: true } as const];
		const a = fakeProvider("a", [[status(429)], [text("ok"), done]], () => obs);
		const q = fakeQuota();
		const { deps: d, waits } = deps({
			discover: async () => [offer(a.adapter, "m")],
			quota: q.quota,
		});
		const out = await collect(createLlmChat(d).chat(req, signal()));
		expect(out.filter((c) => c.type === "model")).toHaveLength(1);
		expect(out.at(-1)).toEqual(done);
		expect(waits).toEqual([2_000]);
		expect(q.settled.map((s) => [s.actual, s.observations])).toEqual([
			[{}, obs],
			[{ tokens_per_minute: 5 }, []],
		]);
	});

	it("moves to the next model after 3 failures and names the switch failed", async () => {
		const a = fakeProvider("a", [[status(503)]]);
		const b = fakeProvider("b", [[text("b"), done]]);
		const q = fakeQuota();
		const { deps: d, waits } = deps({
			discover: async () => [
				offer(a.adapter, "m", 100_000),
				offer(b.adapter, "n"),
			],
			quota: q.quota,
		});
		const out = await collect(createLlmChat(d).chat(req, signal()));
		expect(out.filter((c) => c.type === "model")).toEqual([
			{ type: "model", providerId: "a", modelId: "m", reason: "first" },
			{ type: "model", providerId: "b", modelId: "n", reason: "failed" },
		]);
		expect(a.seen).toHaveLength(3);
		expect(waits).toEqual([2_000, 8_000]);
		expect(q.reserved.at(-1)?.chain).toEqual([
			{ providerId: "b", modelId: "n" },
		]);
		expect(q.settled).toHaveLength(4);
	});

	it("names a model the quota granted instead of the first one quota", async () => {
		const a = fakeProvider("a", [[done]]);
		const b = fakeProvider("b", [[text("b"), done]]);
		const q = fakeQuota(new Set(["a"]));
		const { deps: d } = deps({
			discover: async () => [
				offer(a.adapter, "m", 100_000),
				offer(b.adapter, "n"),
			],
			quota: q.quota,
		});
		const out = await collect(createLlmChat(d).chat(req, signal()));
		expect(out[0]).toEqual({
			type: "model",
			providerId: "b",
			modelId: "n",
			reason: "quota",
		});
	});

	it("moves on at once for a bad request and ends with the last error when the chain runs out", async () => {
		const a = fakeProvider("a", [[status(400)]]);
		const q = fakeQuota();
		const { deps: d, waits } = deps({
			discover: async () => [offer(a.adapter, "m")],
			quota: q.quota,
		});
		const out = await collect(createLlmChat(d).chat(req, signal()));
		expect(waits).toEqual([]);
		expect(out.at(-1)).toMatchObject({
			type: "error",
			error: { code: "bad_request", status: 400 },
		});
	});

	it("ends with the error once a model has streamed text, without retrying", async () => {
		const a = fakeProvider("a", [[text("par"), status(429)]]);
		const b = fakeProvider("b", [[done]]);
		const q = fakeQuota();
		const { deps: d } = deps({
			discover: async () => [
				offer(a.adapter, "m", 100_000),
				offer(b.adapter, "n"),
			],
			quota: q.quota,
		});
		const out = await collect(createLlmChat(d).chat(req, signal()));
		expect(out.map((c) => c.type)).toEqual(["model", "text", "error"]);
		expect(a.seen).toHaveLength(1);
		expect(b.seen).toHaveLength(0);
		expect(q.settled).toHaveLength(1);
	});

	it("ends with no_model when nothing fits and quota_exhausted when the pool says so", async () => {
		const q = fakeQuota();
		const none = deps({ discover: async () => [], quota: q.quota });
		expect(await collect(createLlmChat(none.deps).chat(req, signal()))).toEqual(
			[
				{
					type: "error",
					error: { code: "no_model", message: expect.any(String) },
				},
			],
		);
		const a = fakeProvider("a", [[done]]);
		const resumesAt = new Date(NOW + 60_000).toISOString();
		q.failWith({ code: "quota_exhausted", resumesAt });
		const full = deps({
			discover: async () => [offer(a.adapter, "m")],
			quota: q.quota,
		});
		expect(await collect(createLlmChat(full.deps).chat(req, signal()))).toEqual(
			[
				{
					type: "error",
					error: {
						code: "quota_exhausted",
						message: expect.any(String),
						resumesAt,
					},
				},
			],
		);
	});

	it("ends with aborted for an aborted signal, during a wait or from the pool", async () => {
		const a = fakeProvider("a", [[status(429)]]);
		const q = fakeQuota();
		const c = new AbortController();
		const { deps: d } = deps({
			discover: async () => [offer(a.adapter, "m")],
			quota: q.quota,
			sleep: async () => c.abort(),
		});
		const out = await collect(createLlmChat(d).chat(req, c.signal));
		expect(out.at(-1)).toMatchObject({
			type: "error",
			error: { code: "aborted" },
		});
		expect(a.seen).toHaveLength(1);
		q.failWith({ code: "aborted" });
		const again = await collect(createLlmChat(d).chat(req, signal()));
		expect(again).toEqual([
			{
				type: "error",
				error: { code: "aborted", message: expect.any(String) },
			},
		]);
	});

	it("settles once when the caller stops reading mid-stream", async () => {
		const a = fakeProvider("a", [[text("1"), text("2"), done]]);
		const q = fakeQuota();
		const { deps: d } = deps({
			discover: async () => [offer(a.adapter, "m")],
			quota: q.quota,
		});
		for await (const chunk of createLlmChat(d).chat(req, signal()))
			if (chunk.type === "text") break;
		expect(q.settled).toEqual([{ id: "r1", actual: {}, observations: [] }]);
	});

	it("settles when the caller stops at the model chunk", async () => {
		const a = fakeProvider("a", [[text("1"), done]]);
		const q = fakeQuota();
		const { deps: d } = deps({
			discover: async () => [offer(a.adapter, "m")],
			quota: q.quota,
		});
		for await (const chunk of createLlmChat(d).chat(req, signal()))
			if (chunk.type === "model") break;
		expect(q.settled).toEqual([{ id: "r1", actual: {}, observations: [] }]);
	});
});

describe("llm.chat@1 model_calls rows", () => {
	it("records every provider call, retries included, with the masked request", async () => {
		const a = fakeProvider("a", [[status(429)], [text("o"), text("k"), done]]);
		const q = fakeQuota();
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
		await collect(createLlmChat(d).chat(req, signal()));
		expect(calls).toEqual([
			expect.objectContaining({
				outcome: "rate_limited",
				promptTokens: 0,
				tier: "coder",
			}),
			{
				ts: new Date(NOW).toISOString(),
				runId: RUN,
				providerId: "a",
				modelId: "m",
				tier: "coder",
				request: {
					messages: [{ role: "user", content: "hello [SECRET:x]" }],
					tools: [],
				},
				response: { text: "ok", toolCalls: [] },
				promptTokens: 3,
				completionTokens: 2,
				latencyMs: 0,
				outcome: "stop",
			},
		]);
	});

	it("logs a call the caller stopped reading as aborted, and a model target without a tier", async () => {
		const a = fakeProvider("a", [[text("1"), text("2"), done]]);
		const { deps: d, calls } = deps({
			discover: async () => [offer(a.adapter, "m")],
			quota: fakeQuota().quota,
		});
		const exact = { ...req, target: { providerId: "a", modelId: "m" } };
		for await (const chunk of createLlmChat(d).chat(exact, signal()))
			if (chunk.type === "text") break;
		expect(calls).toEqual([
			expect.objectContaining({
				tier: null,
				outcome: "aborted",
				response: { text: "1", toolCalls: [] },
			}),
		]);
	});

	it("records the finish and its tokens when the caller stops at the finish chunk", async () => {
		const a = fakeProvider("a", [[text("hi"), done]]);
		const q = fakeQuota();
		const { deps: d, calls } = deps({
			discover: async () => [offer(a.adapter, "m")],
			quota: q.quota,
		});
		for await (const chunk of createLlmChat(d).chat(req, signal()))
			if (chunk.type === "finish") break;
		expect(q.settled).toEqual([
			{ id: "r1", actual: { tokens_per_minute: 5 }, observations: [] },
		]);
		expect(calls).toEqual([
			expect.objectContaining({
				outcome: "stop",
				promptTokens: 3,
				completionTokens: 2,
			}),
		]);
	});

	it("writes no row when no call was sent", async () => {
		const a = fakeProvider("a", [[done]]);
		const q = fakeQuota();
		q.failWith({ code: "aborted" });
		const { deps: d, calls } = deps({
			discover: async () => [offer(a.adapter, "m")],
			quota: q.quota,
		});
		await collect(createLlmChat(d).chat(req, signal()));
		expect(calls).toEqual([]);
	});
});
