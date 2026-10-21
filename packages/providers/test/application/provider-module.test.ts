import {
	err,
	ok,
	type ProviderAdapter,
	type SecretStore,
} from "@mete/contracts";
import {
	createCapabilityRegistry,
	createConfigReader,
	createEventBus,
	type ModuleContext,
} from "@mete/kernel";
import { describe, expect, it } from "vitest";
import {
	apiKeyName,
	createProviderModule,
	type ProviderDefinition,
	type ProviderEnv,
} from "../../src/application/provider-module.js";
import type { ModelRow } from "../../src/domain/model-data.js";

const row = (over: Partial<ModelRow> = {}): ModelRow => ({
	capability: "chat",
	contextWindow: 1000,
	toolCalling: true,
	vision: false,
	free: true,
	family: "f",
	...over,
});

const secrets = (saved: Record<string, string>): SecretStore => ({
	get: async (name) => ok(saved[name]),
	set: async () => ok(undefined),
	delete: async () => ok(false),
});

const context = (opts: { secrets?: SecretStore; models?: unknown } = {}) => {
	const registry = createCapabilityRegistry(() => []);
	const log = () => {};
	const ctx: ModuleContext = {
		capabilities: registry,
		events: createEventBus((e) => {
			throw e;
		}),
		config: createConfigReader({
			global: { file: "settings.yaml", sections: {} },
			workspace:
				opts.models === undefined
					? {}
					: { models: { file: ".mete/models.yaml", value: opts.models } },
		}),
		logger: { error: log, warn: log, info: log, debug: log },
		disposables: { add: () => {}, dispose: () => {} },
		...(opts.secrets ? { secrets: opts.secrets } : {}),
	};
	return { ctx, registry };
};

const definition = () => {
	const built: ProviderEnv[] = [];
	const def: ProviderDefinition = {
		providerId: "p",
		moduleId: "provider-p",
		displayName: "P",
		provides: ["provider.chat@1", "provider.embed@1"],
		build: (env) => {
			built.push(env);
			return { id: "p" } as unknown as ProviderAdapter;
		},
	};
	return { def, built };
};

const shippedModels = { p: { a: row(), b: row({ family: "shipped" }) } };

describe("provider module", () => {
	it("declares net and secrets and fails without the secrets permission", async () => {
		const { def } = definition();
		const m = createProviderModule(def, { shippedModels });
		expect(m.manifest.permissions).toEqual(["net", "secrets"]);
		const r = await m.activate(context().ctx);
		expect(!r.ok && r.error.message).toMatch(/secrets/);
	});

	it("stays inactive with no API key or when the keychain fails", async () => {
		const { def } = definition();
		const m = createProviderModule(def, { shippedModels });
		const none = await m.activate(context({ secrets: secrets({}) }).ctx);
		expect(!none.ok && none.error.message).toBe("no API key");
		const broken: SecretStore = {
			...secrets({}),
			get: async () =>
				err({ code: "secret_failed", message: "read x: locked" }),
		};
		const failed = await m.activate(context({ secrets: broken }).ctx);
		expect(!failed.ok && failed.error.message).toBe("read x: locked");
	});

	it("builds the adapter from the key and merged rows and provides it under every ref", async () => {
		const { def, built } = definition();
		const m = createProviderModule(def, { shippedModels });
		const { ctx, registry } = context({
			secrets: secrets({ [apiKeyName("p")]: "key-1" }),
			models: { p: { b: row({ family: "user" }), c: row() } },
		});
		expect(await m.activate(ctx)).toEqual({ ok: true, value: undefined });
		expect(built[0]?.apiKey).toBe("key-1");
		expect(built[0]?.models).toEqual({
			a: row(),
			b: row({ family: "user" }),
			c: row(),
		});
		expect(registry.has("provider.chat@1")).toBe(true);
		expect(registry.has("provider.embed@1")).toBe(true);
		await m.deactivate();
		expect(registry.has("provider.chat@1")).toBe(false);
	});

	it("names the file of an invalid user row", async () => {
		const { def } = definition();
		const m = createProviderModule(def, { shippedModels });
		const r = await m.activate(
			context({
				secrets: secrets({ [apiKeyName("p")]: "k" }),
				models: { p: { a: { capability: "chat" } } },
			}).ctx,
		);
		expect(!r.ok && r.error.message).toMatch(/^\.mete\/models\.yaml p\.a/);
	});
});
