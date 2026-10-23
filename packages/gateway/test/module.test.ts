import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type LlmChatAdapter,
	type LlmChatRequest,
	ok,
	type ProviderAdapter,
	type QuotaUnitSpec,
	type SecretsMaskAdapter,
	type StorageSqlAdapter,
} from "@mete/contracts";
import {
	createCapabilityRegistry,
	createConfigReader,
	createEventBus,
	type ModuleContext,
} from "@mete/kernel";
import { createStorageModule } from "@mete/storage";
import { afterAll, describe, expect, it } from "vitest";
import { createGatewayModule } from "../src/module.js";
import {
	collect,
	done,
	fakeProvider,
	fakeQuota,
	NOW,
	RUN,
	text,
} from "./application/fakes.js";

// Real storage in a temp folder; providers, quota and masking are fakes behind the registry.

const roots: string[] = [];
afterAll(async () => {
	await Promise.all(roots.map((r) => rm(r, { recursive: true, force: true })));
});

const model = (providerId: string) => ({
	id: "m",
	providerId,
	family: "f",
	contextWindow: 64_000,
	toolCalling: true,
	vision: false,
	free: true,
	deprecated: false,
});

const trainingProvider = () => {
	const p = fakeProvider("t", [[text("t"), done]]);
	const adapter: ProviderAdapter = {
		...p.adapter,
		listModels: async () => ok([model("t")]),
		privacy: () => ({ trains: true, logs: true, publishes: false }),
	};
	return adapter;
};

const req: LlmChatRequest = {
	target: { tier: "coder" },
	runId: RUN,
	priority: 0,
	messages: [{ role: "user", content: "hi" }],
};

// What the lifecycle does with a module's disposables on deactivate.
const disposableStore = () => {
	const items: { dispose(): void }[] = [];
	return {
		add: (d: { dispose(): void }) => void items.push(d),
		dispose: () => {
			for (const d of items.splice(0)) d.dispose();
		},
	};
};

type Sections = Record<string, { file: string; value: unknown }>;

const setup = async (workspace: Sections = {}) => {
	const root = await mkdtemp(join(tmpdir(), "mete-gateway-"));
	roots.push(root);
	const registry = createCapabilityRegistry(() => []);
	const warnings: string[] = [];
	const log = () => {};
	const base = {
		capabilities: registry,
		events: createEventBus((e) => {
			throw e;
		}),
		config: createConfigReader({
			global: { file: join(root, "settings.yaml"), sections: {} },
			workspace,
		}),
		logger: {
			error: log,
			warn: (_: unknown, msg: string) => warnings.push(msg),
			info: log,
			debug: log,
		},
		disposables: disposableStore(),
	} satisfies ModuleContext;
	const dirs = {
		workspaceDir: join(root, "repo"),
		globalDir: join(root, "global"),
	};
	const storage = createStorageModule(dirs);
	await storage.activate(base);
	const sql = registry.resolve<StorageSqlAdapter>("storage.sql@1");
	if (!sql.ok) throw new Error("storage.sql@1 missing");
	const scoped = sql.value[0].impl.scopeFor("gateway");
	const q = fakeQuota();
	const defined: QuotaUnitSpec[][] = [];
	const quota = {
		...q.quota,
		define: (s: readonly QuotaUnitSpec[]) => void defined.push([...s]),
	};
	const core = { trust: "core", features: [] } as const;
	const quotaHandle = registry.provide("quota.reserve@3", {
		id: "quota",
		...core,
		impl: quota,
	});
	const mask: SecretsMaskAdapter = {
		mask: async (t) => ({ text: t, masked: 0 }),
	};
	registry.provide("secrets.mask@1", { id: "security", ...core, impl: mask });
	const a = fakeProvider("a", [[text("hi"), done]]);
	const provider = { ...a.adapter, listModels: async () => ok([model("a")]) };
	registry.provide("provider.chat@2", {
		id: "a",
		trust: "first-party",
		features: [],
		impl: provider,
	});
	const gateway = createGatewayModule({
		now: () => NOW,
		sleep: async () => {},
	});
	const ctx: ModuleContext = { ...base, storage: scoped };
	const chat = () => {
		const r = registry.resolve<LlmChatAdapter>("llm.chat@1");
		if (!r.ok) throw new Error("llm.chat@1 missing");
		return r.value[0].impl;
	};
	return {
		registry,
		ctx,
		gateway,
		chat,
		db: scoped.workspace,
		defined,
		warnings,
		quotaHandle,
		close: () => storage.deactivate(),
	};
};

describe("gateway module", () => {
	it("provides llm.chat@1, defines provider units first and logs each call", async () => {
		const s = await setup();
		expect(await s.gateway.activate(s.ctx)).toEqual(ok(undefined));
		const out = await collect(s.chat().chat(req, new AbortController().signal));
		expect(out.map((c) => c.type)).toEqual(["model", "text", "finish"]);
		// The spending cap over every provider (ADR-042), then the provider's own units.
		expect(s.defined[0]).toEqual([
			{
				providerId: "*",
				unit: "usd_per_day",
				limit: 1,
				scope: "account",
				reset: "fixed_daily",
			},
		]);
		expect(s.defined).toHaveLength(2);
		expect(
			s.db.prepare("SELECT provider_id, outcome FROM model_calls").all(),
		).toEqual([{ provider_id: "a", outcome: "stop" }]);
		await s.close();
	});

	it("excludes training providers by default and admits them when the user allows it", async () => {
		const deny = await setup();
		deny.registry.provide("provider.chat@2", {
			id: "t",
			trust: "first-party",
			features: [],
			impl: trainingProvider(),
		});
		await deny.gateway.activate(deny.ctx);
		const target = { providerId: "t", modelId: "m" };
		const denied = await collect(
			deny.chat().chat({ ...req, target }, new AbortController().signal),
		);
		expect(denied).toMatchObject([
			{ type: "error", error: { code: "no_model" } },
		]);
		await deny.close();
		const allow = await setup({
			privacy: { file: "privacy.yaml", value: { allowTraining: true } },
		});
		allow.registry.provide("provider.chat@2", {
			id: "t",
			trust: "first-party",
			features: [],
			impl: trainingProvider(),
		});
		await allow.gateway.activate(allow.ctx);
		const allowed = await collect(
			allow.chat().chat({ ...req, target }, new AbortController().signal),
		);
		expect(allowed.at(-1)?.type).toBe("finish");
		await allow.close();
	});

	it("keeps a sensitive workspace strict even when training is allowed", async () => {
		const s = await setup({
			privacy: { file: "privacy.yaml", value: { allowTraining: true } },
			workspace: {
				file: "workspace.yaml",
				value: { id: RUN, sensitivity: "sensitive" },
			},
		});
		s.registry.provide("provider.chat@2", {
			id: "t",
			trust: "first-party",
			features: [],
			impl: trainingProvider(),
		});
		await s.gateway.activate(s.ctx);
		const target = { providerId: "t", modelId: "m" };
		const out = await collect(
			s.chat().chat({ ...req, target }, new AbortController().signal),
		);
		expect(out).toMatchObject([{ type: "error", error: { code: "no_model" } }]);
		await s.close();
	});

	it("fails activation on invalid privacy settings and without storage", async () => {
		const s = await setup({
			privacy: { file: "privacy.yaml", value: { allowTraining: "yes" } },
		});
		const bad = await s.gateway.activate(s.ctx);
		expect(bad.ok).toBe(false);
		if (!bad.ok) expect(bad.error.message).toContain("privacy.yaml");
		const { storage: _, ...bare } = s.ctx;
		expect((await s.gateway.activate(bare)).ok).toBe(false);
		await s.close();
	});

	it("prunes rows older than the retention when it activates", async () => {
		const s = await setup();
		await s.gateway.activate(s.ctx);
		const insert = s.db.prepare(
			"INSERT INTO model_calls VALUES (?, ?, 'r', 'p', 'm', NULL, '{}', '{}', 0, 0, 0, 'stop')",
		);
		insert.run("old", new Date(NOW - 91 * 86_400_000).toISOString());
		insert.run("new", new Date(NOW - 89 * 86_400_000).toISOString());
		await s.gateway.deactivate();
		s.ctx.disposables.dispose();
		await s.gateway.activate(s.ctx);
		expect(s.db.prepare("SELECT id FROM model_calls").all()).toEqual([
			{ id: "new" },
		]);
		await s.close();
	});

	it("defines provider units again for a restarted quota module", async () => {
		const s = await setup();
		await s.gateway.activate(s.ctx);
		await collect(s.chat().chat(req, new AbortController().signal));
		s.quotaHandle.dispose();
		const again: QuotaUnitSpec[][] = [];
		const q = fakeQuota();
		s.registry.provide("quota.reserve@3", {
			id: "quota",
			trust: "core",
			features: [],
			impl: {
				...q.quota,
				define: (u: readonly QuotaUnitSpec[]) => void again.push([...u]),
			},
		});
		const out = await collect(s.chat().chat(req, new AbortController().signal));
		expect(out.at(-1)?.type).toBe("finish");
		expect(s.defined).toHaveLength(2);
		expect(again).toHaveLength(2);
		await s.close();
	});

	it("lists usable models while active and none once deactivated", async () => {
		const s = await setup();
		s.registry.provide("provider.chat@2", {
			id: "t",
			trust: "first-party",
			features: [],
			impl: trainingProvider(),
		});
		const signal = new AbortController().signal;
		expect(await s.gateway.models(signal)).toEqual([]);
		await s.gateway.activate(s.ctx);
		expect(await s.gateway.models(signal)).toEqual([
			{ providerId: "a", modelId: "m" },
		]);
		await s.gateway.deactivate();
		expect(await s.gateway.models(signal)).toEqual([]);
		await s.close();
	});

	it("reports a failed log write and still finishes the call", async () => {
		const s = await setup();
		await s.gateway.activate(s.ctx);
		s.db.exec("DROP TABLE model_calls");
		const out = await collect(s.chat().chat(req, new AbortController().signal));
		expect(out.at(-1)?.type).toBe("finish");
		expect(s.warnings).toContain("model_calls row not written");
		await s.close();
	});
});
