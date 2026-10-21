import {
	type ChatMessage,
	err,
	type ModelInfo,
	ok,
	type ProviderAdapter,
	type QuotaUnitSpec,
	type SecretsMaskAdapter,
} from "@mete/contracts";
import { describe, expect, it } from "vitest";
import {
	createDiscovery,
	maskMessages,
} from "../../src/application/prepare.js";

const mask: SecretsMaskAdapter = {
	mask: async (text) => {
		const out = text.replaceAll("sk-live", "[SECRET:1234abcd]");
		return { text: out, masked: out === text ? 0 : 1 };
	},
};

describe("maskMessages", () => {
	it("masks text of every role, text parts and tool-call arguments", async () => {
		const messages: ChatMessage[] = [
			{ role: "system", content: "key sk-live" },
			{
				role: "user",
				content: [
					{ type: "text", text: "use sk-live" },
					{ type: "image", mediaType: "image/png", data: "AAAA" },
				],
			},
			{
				role: "assistant",
				content: "ok sk-live",
				toolCalls: [{ id: "c", name: "t", args: { token: "sk-live", n: 1 } }],
			},
			{ role: "tool", toolCallId: "c", content: "echo sk-live" },
		];
		expect(await maskMessages(mask, messages)).toEqual([
			{ role: "system", content: "key [SECRET:1234abcd]" },
			{
				role: "user",
				content: [
					{ type: "text", text: "use [SECRET:1234abcd]" },
					{ type: "image", mediaType: "image/png", data: "AAAA" },
				],
			},
			{
				role: "assistant",
				content: "ok [SECRET:1234abcd]",
				toolCalls: [
					{ id: "c", name: "t", args: { token: "[SECRET:1234abcd]", n: 1 } },
				],
			},
			{ role: "tool", toolCallId: "c", content: "echo [SECRET:1234abcd]" },
		]);
	});

	it("keeps arguments that hold no secret as they were", async () => {
		const args = { a: [1, 2] };
		const [m] = await maskMessages(mask, [
			{
				role: "assistant",
				content: "",
				toolCalls: [{ id: "c", name: "t", args }],
			},
		]);
		expect(m?.role === "assistant" && m.toolCalls?.[0]?.args).toBe(args);
	});
});

const info = (providerId: string, id: string): ModelInfo => ({
	id,
	providerId,
	family: "",
	contextWindow: 64_000,
	toolCalling: true,
	vision: false,
	free: true,
	deprecated: false,
});

const fakeAdapter = (
	id: string,
	lists: () => ReturnType<ProviderAdapter["listModels"]>,
) => {
	const calls = { list: 0 };
	const adapter: ProviderAdapter = {
		id,
		format: "openai-chat",
		listModels: () => {
			calls.list++;
			return lists();
		},
		chat: async function* () {},
		quotaUnits: () => [
			{
				providerId: id,
				unit: "requests_per_minute",
				limit: 10,
				scope: "account",
				reset: "sliding",
			},
		],
		observe: () => [],
		privacy: (m) => ({ trains: m.id === "t", logs: false, publishes: false }),
	};
	return { adapter, calls };
};

describe("createDiscovery", () => {
	const signal = new AbortController().signal;

	it("defines each provider's units once, before its models are offered, and caches listings", async () => {
		const a = fakeAdapter("a", async () =>
			ok([info("a", "m"), info("a", "t")]),
		);
		const defined: QuotaUnitSpec[][] = [];
		const discover = createDiscovery({
			providers: () => [a.adapter],
			define: (s) => defined.push([...s]),
			warn: () => {},
		});
		const first = await discover(signal);
		await discover(signal);
		expect(a.calls.list).toBe(1);
		expect(defined).toEqual([a.adapter.quotaUnits()]);
		expect(first.map((d) => [d.model.id, d.privacy.trains, d.adapter])).toEqual(
			[
				["m", false, a.adapter],
				["t", true, a.adapter],
			],
		);
	});

	it("retries a failed listing on the next call and warns, keeping other providers", async () => {
		let fail = true;
		const a = fakeAdapter("a", async () =>
			fail ? err({ code: "network", message: "down" }) : ok([info("a", "m")]),
		);
		const b = fakeAdapter("b", async () => ok([info("b", "n")]));
		const warnings: string[] = [];
		const discover = createDiscovery({
			providers: () => [a.adapter, b.adapter],
			define: () => {},
			warn: (msg) => warnings.push(msg),
		});
		expect((await discover(signal)).map((d) => d.model.id)).toEqual(["n"]);
		expect(warnings).toEqual(["a: listing models failed: down"]);
		fail = false;
		expect((await discover(signal)).map((d) => d.model.id)).toEqual(["m", "n"]);
		expect(a.calls.list).toBe(2);
	});

	it("drops a provider whose adapter is no longer registered", async () => {
		const a = fakeAdapter("a", async () => ok([info("a", "m")]));
		let list = [a.adapter];
		const discover = createDiscovery({
			providers: () => list,
			define: () => {},
			warn: () => {},
		});
		await discover(signal);
		list = [];
		expect(await discover(signal)).toEqual([]);
	});
});
