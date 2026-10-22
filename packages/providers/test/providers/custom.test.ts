import { ok, type ProviderAdapter, type SecretStore } from "@mete/contracts";
import {
	createCapabilityRegistry,
	createConfigReader,
	createEventBus,
	type ModuleContext,
} from "@mete/kernel";
import { describe, expect, it } from "vitest";
import { createCustomModule } from "../../src/providers/custom.js";

const NOW = Date.parse("2026-10-21T12:00:00Z");

const endpoint = (slug: string, format = "openai-chat") => ({
	slug,
	name: slug,
	baseUrl: `https://${slug}.test/v1`,
	format,
	headers: { "x-team": "mete" },
});

const setup = (
	providers: unknown,
	keys: Record<string, string>,
	models?: unknown,
) => {
	const registry = createCapabilityRegistry(() => []);
	const warnings: unknown[] = [];
	const log = () => {};
	const secrets: SecretStore = {
		get: async (name) => ok(keys[name]),
		set: async () => ok(undefined),
		delete: async () => ok(false),
	};
	const ctx: ModuleContext = {
		capabilities: registry,
		events: createEventBus((e) => {
			throw e;
		}),
		config: createConfigReader({
			global: {
				file: "settings.yaml",
				sections: { providers, ...(models ? { models } : {}) },
			},
			workspace: {},
		}),
		logger: {
			error: log,
			warn: (f) => warnings.push(f),
			info: log,
			debug: log,
		},
		disposables: { add: () => {}, dispose: () => {} },
		secrets,
	};
	const seen: { url: string; headers: Headers }[] = [];
	const fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
		seen.push({ url: String(url), headers: new Headers(init?.headers) });
		return Response.json({ data: [{ id: "lab-model" }] });
	};
	const module = createCustomModule({ fetch, now: () => NOW });
	return { ctx, registry, warnings, module, seen };
};

const adapters = (s: ReturnType<typeof setup>) => {
	const r = s.registry.resolve<ProviderAdapter>("provider.chat@2");
	return r.ok ? r.value.map((a) => a.id) : [];
};

describe("custom endpoints", () => {
	it("provides one adapter per endpoint with a key and skips the others with a warning", async () => {
		const s = setup(
			{
				custom: [
					endpoint("lab"),
					endpoint("nokey"),
					endpoint("claude", "anthropic-messages"),
				],
			},
			{
				"providers/custom:lab/apiKey": "k1",
				"providers/custom:claude/apiKey": "k2",
			},
		);
		expect(await s.module.activate(s.ctx)).toEqual({
			ok: true,
			value: undefined,
		});
		expect(adapters(s)).toEqual(["custom:lab", "custom:claude"]);
		const embed = s.registry.resolve<ProviderAdapter>("provider.embed@1");
		expect(embed.ok && embed.value.map((a) => a.id)).toEqual(["custom:lab"]);
		expect(s.warnings).toEqual([
			{ endpoint: "custom:nokey", reason: "no API key" },
		]);
		await s.module.deactivate();
		expect(adapters(s)).toEqual([]);
		// The lifecycle restarts a module on the same instance.
		expect((await s.module.activate(s.ctx)).ok).toBe(true);
		expect(adapters(s)).toEqual(["custom:lab", "custom:claude"]);
		await s.module.deactivate();
	});

	it("lists an anthropic endpoint's models with its metadata under the user's rows", async () => {
		const s = setup(
			{ custom: [endpoint("claude", "anthropic-messages")] },
			{ "providers/custom:claude/apiKey": "k2" },
			{
				"custom:claude": {
					"lab-model": {
						capability: "chat",
						contextWindow: 100_000,
						toolCalling: true,
						vision: true,
						free: true,
						family: "claude",
					},
				},
			},
		);
		await s.module.activate(s.ctx);
		const r = s.registry.resolve<ProviderAdapter>("provider.chat@2");
		const adapter = r.ok ? r.value[0]?.impl : undefined;
		const models = await adapter?.listModels(new AbortController().signal);
		expect(s.seen[0]?.url).toBe("https://claude.test/v1/models?limit=1000");
		expect(s.seen[0]?.headers.get("x-api-key")).toBe("k2");
		expect(models?.ok && models.value).toEqual([
			{
				id: "lab-model",
				providerId: "custom:claude",
				family: "claude",
				contextWindow: 100_000,
				toolCalling: true,
				vision: true,
				free: true,
				deprecated: false,
			},
		]);
		expect(adapter?.format).toBe("anthropic-messages");
		expect(adapter?.embed).toBeUndefined();
	});

	it("activates with nothing when no endpoints are configured", async () => {
		const s = setup(undefined, {});
		expect(await s.module.activate(s.ctx)).toEqual({
			ok: true,
			value: undefined,
		});
		expect(s.registry.has("provider.chat@2")).toBe(false);
	});

	it("fails on a slug used twice, naming the file", async () => {
		const s = setup({ custom: [endpoint("lab"), endpoint("lab")] }, {});
		const r = await s.module.activate(s.ctx);
		expect(!r.ok && r.error.message).toMatch(
			/^settings\.yaml providers\.custom\.1\.slug/,
		);
	});

	it("lists models with the endpoint's key and headers, using its rows, quota and privacy", async () => {
		const s = setup(
			{ custom: [endpoint("lab")] },
			{ "providers/custom:lab/apiKey": "k1" },
			{
				"custom:lab": {
					"lab-model": {
						capability: "chat",
						contextWindow: 64_000,
						toolCalling: true,
						vision: false,
						free: true,
						family: "lab",
						privacy: { trains: false, logs: false, publishes: false },
					},
				},
			},
		);
		await s.module.activate(s.ctx);
		const r = s.registry.resolve<ProviderAdapter>("provider.chat@2");
		const adapter = r.ok ? r.value[0]?.impl : undefined;
		if (!adapter) throw new Error("no adapter");
		const models = await adapter.listModels(new AbortController().signal);
		expect(models.ok && models.value[0]).toMatchObject({
			id: "lab-model",
			providerId: "custom:lab",
			contextWindow: 64_000,
		});
		expect(s.seen[0]?.url).toBe("https://lab.test/v1/models");
		expect(s.seen[0]?.headers.get("authorization")).toBe("Bearer k1");
		expect(s.seen[0]?.headers.get("x-team")).toBe("mete");
		expect(adapter.quotaUnits()).toEqual([
			{
				providerId: "custom:lab",
				unit: "requests_per_minute",
				limit: "discover",
				scope: "account",
				reset: "sliding",
			},
		]);
		expect(adapter.observe(429, new Headers({ "retry-after": "1" }))).toEqual([
			{
				unit: "requests_per_minute",
				exhausted: true,
				resetsAt: "2026-10-21T12:00:01.000Z",
			},
		]);
		if (!models.ok || !models.value[0]) throw new Error("no models");
		expect(adapter.privacy(models.value[0])).toEqual({
			trains: false,
			logs: false,
			publishes: false,
		});
	});
});
