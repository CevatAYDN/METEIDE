import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	LlmChatAdapter,
	LlmChunk,
	MeteEvent,
	TeamEngineAdapter,
} from "@mete/contracts";
import {
	createCapabilityRegistry,
	createConfigReader,
	createEventBus,
	type ModuleContext,
} from "@mete/kernel";
import { createStorageModule } from "@mete/storage";
import { type EngineScenario, teamEngineContract } from "@mete/testing";
import { afterAll, describe, expect, it } from "vitest";
import { createCoreEngineModule } from "../src/module.js";
import { reply, slow } from "./helpers/engine.js";

// Real storage in a temp folder; the model behind llm.chat@1 is a fake.

const roots: string[] = [];
afterAll(async () => {
	await Promise.all(roots.map((r) => rm(r, { recursive: true, force: true })));
});

const disposableStore = () => {
	const items: { dispose(): void }[] = [];
	return {
		add: (d: { dispose(): void }) => void items.push(d),
		dispose: () => {
			for (const d of items.splice(0)) d.dispose();
		},
	};
};

const DAY_MS = 86_400_000;

const chatFor = (scenario: EngineScenario): LlmChatAdapter["chat"] =>
	async function* (req, signal) {
		if (scenario === "slow") return yield* slow(req, signal);
		if (scenario === "answers") return yield* reply("hello");
		const resumesAt = new Date(Date.now() + DAY_MS).toISOString();
		const error = { code: "quota_exhausted", message: "q", resumesAt } as const;
		yield { type: "error", error } satisfies LlmChunk;
	};

const setup = async (scenario: EngineScenario | "none") => {
	const root = await mkdtemp(join(tmpdir(), "mete-core-"));
	roots.push(root);
	const registry = createCapabilityRegistry(() => []);
	const events: MeteEvent[] = [];
	const bus = createEventBus((e) => {
		throw e;
	});
	bus.subscribe("run.*", (e) => events.push(e));
	const log = () => {};
	const disposables = disposableStore();
	const base = {
		capabilities: registry,
		events: bus,
		config: createConfigReader({
			global: { file: join(root, "settings.yaml"), sections: {} },
			workspace: {},
		}),
		logger: { error: log, warn: log, info: log, debug: log },
		disposables,
	} satisfies ModuleContext;
	const storage = createStorageModule({
		workspaceDir: join(root, "repo"),
		globalDir: join(root, "global"),
	});
	await storage.activate({ ...base, disposables: disposableStore() });
	const sql = registry.resolve<{
		scopeFor(id: string): ModuleContext["storage"];
	}>("storage.sql@1");
	if (!sql.ok) throw new Error("storage.sql@1 missing");
	if (scenario !== "none")
		registry.provide<LlmChatAdapter>("llm.chat@1", {
			id: "gateway",
			trust: "core",
			features: [],
			impl: { chat: chatFor(scenario) },
		});
	const module = createCoreEngineModule({ workspaceId: randomUUID() });
	const storageCtx = sql.value[0].impl.scopeFor("core-engine");
	const activated = await module.activate({
		...base,
		...(storageCtx ? { storage: storageCtx } : {}),
	});
	const close = async () => {
		await module.deactivate();
		disposables.dispose();
		await storage.deactivate();
	};
	return { module, registry, events, activated, close, base };
};

const engineOf = (registry: ModuleContext["capabilities"]) => {
	const r = registry.resolve<TeamEngineAdapter>("team.engine@1");
	if (!r.ok) throw new Error("team.engine@1 missing");
	return r.value[0].impl;
};

teamEngineContract("core-engine", async (scenario) => {
	const h = await setup(scenario);
	return { engine: engineOf(h.registry), events: h.events, close: h.close };
});

describe("core-engine module", () => {
	it("fails to activate without storage", async () => {
		const h = await setup("answers");
		const bare = createCoreEngineModule({ workspaceId: randomUUID() });
		const r = await bare.activate(h.base);
		expect(r.ok ? undefined : r.error).toMatchObject({
			code: "activation_failed",
			moduleId: "core-engine",
		});
		await h.close();
	});

	it("pauses its running runs and stops providing team.engine@1 on deactivate", async () => {
		const h = await setup("slow");
		const engine = engineOf(h.registry);
		const started = await engine.start({ goal: "wait" });
		if (!started.ok) throw new Error(started.error.message);
		await h.close();
		expect(h.registry.has("team.engine@1")).toBe(false);
		expect(h.events.map((e) => e.type)).toEqual([
			"run.created",
			"run.started",
			"run.paused",
		]);
	});
});
