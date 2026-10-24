import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type CheckpointRestoreAdapter,
	err,
	type LlmChatAdapter,
	type LlmChunk,
	type MeteEvent,
	ok,
	type StorageSqlAdapter,
	type TeamEngineAdapter,
	type VcsGitAdapter,
} from "@mete/contracts";
import {
	createCapabilityRegistry,
	createConfigReader,
	createEventBus,
	type ModuleContext,
} from "@mete/kernel";
import { createStorageModule } from "@mete/storage";
import {
	type CheckpointKind,
	checkpointRef,
	checkpointRestoreContract,
	type EngineScenario,
	teamEngineContract,
} from "@mete/testing";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createSnapshotStore } from "../src/infrastructure/snapshot-store.js";
import { createCoreEngineModule } from "../src/module.js";
import { reply, slow } from "./helpers/engine.js";

// Real storage in a temp folder; the model behind llm.chat@2 is a fake.

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
		registry.provide<LlmChatAdapter>("llm.chat@2", {
			id: "gateway",
			trust: "core",
			features: [],
			impl: { chat: chatFor(scenario) },
		});
	const module = createCoreEngineModule({
		workspaceId: randomUUID(),
		workspaceDir: join(root, "repo"),
		snapshotsDir: join(root, "snapshots"),
	});
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
	return { module, registry, events, activated, close, base, root };
};

const engineOf = (registry: ModuleContext["capabilities"]) => {
	const r = registry.resolve<TeamEngineAdapter>("team.engine@2");
	if (!r.ok) throw new Error("team.engine@2 missing");
	return r.value[0].impl;
};

teamEngineContract("core-engine", async (scenario) => {
	const h = await setup(scenario);
	return { engine: engineOf(h.registry), events: h.events, close: h.close };
});

// A vcs.git@2 that keeps checkpoint refs in memory: create numbers them per run, restore knows them.
const fakeVcs = (): VcsGitAdapter => {
	const refs = new Set<string>();
	const counts = new Map<string, number>();
	return {
		run: async (input) => {
			if (input.op === "checkpoint.create") {
				const n = (counts.get(input.runId) ?? 0) + 1;
				counts.set(input.runId, n);
				const ref = `refs/mete/checkpoints/${input.runId}/${n}`;
				refs.add(ref);
				return ok({ op: "checkpoint.create", ref, sha: "0".repeat(40) });
			}
			if (input.op === "checkpoint.restore")
				return refs.has(input.ref)
					? ok({ op: "checkpoint.restore", ref: input.ref })
					: err({ code: "not_found", message: `no checkpoint ${input.ref}` });
			return err({ code: "io", message: `not faked: ${input.op}` });
		},
	};
};

const restoreOf = (registry: ModuleContext["capabilities"]) => {
	const r = registry.resolve<CheckpointRestoreAdapter>("checkpoint.restore@1");
	if (!r.ok) throw new Error("checkpoint.restore@1 missing");
	return r.value[0].impl;
};

// A run of the slow model, paused once it runs.
const pausedRun = async (engine: TeamEngineAdapter) => {
	const r = await engine.start({ goal: "wait" });
	if (!r.ok) throw new Error(r.error.message);
	await engine.pause(r.value.runId);
	await vi.waitFor(() => {
		const s = engine.status(r.value.runId);
		expect(s.ok && s.value[0]?.status).toBe("paused");
	});
	return r.value.runId;
};

// A checkpoint of the paused run: a fake git ref, or a real file snapshot in the temp folder.
const madeCheckpoint = async (
	kind: CheckpointKind,
	vcs: VcsGitAdapter,
	root: string,
	runId: string,
) => {
	if (kind === "snapshot") {
		const store = createSnapshotStore(
			join(root, "snapshots"),
			join(root, "repo"),
		);
		const opened = await store.open(runId, 0);
		if (!opened.ok) throw new Error(opened.error.message);
		await store.keep(opened.value, "a.txt");
		return opened.value;
	}
	const made = await vcs.run(
		{ op: "checkpoint.create", runId },
		{ signal: new AbortController().signal },
	);
	if (!made.ok || made.value.op !== "checkpoint.create")
		throw new Error("no checkpoint");
	return made.value.ref;
};

checkpointRestoreContract("core-engine", async (kind) => {
	const h = await setup("slow");
	const vcs = fakeVcs();
	if (kind === "git")
		h.registry.provide<VcsGitAdapter>("vcs.git@2", {
			id: "vcs-git",
			trust: "core",
			features: [],
			impl: vcs,
		});
	const engine = engineOf(h.registry);
	const paused = await pausedRun(engine);
	const running = await engine.start({ goal: "wait" });
	if (!running.ok) throw new Error(running.error.message);
	const ref = await madeCheckpoint(kind, vcs, h.root, paused);
	const events: MeteEvent[] = [];
	h.base.events.subscribe("checkpoint.*", (e) => events.push(e));
	h.base.events.subscribe("rollback.*", (e) => events.push(e));
	const runningId = running.value.runId;
	return {
		adapter: restoreOf(h.registry),
		events,
		paused: { runId: paused, checkpointId: randomUUID(), ref },
		running: {
			runId: runningId,
			checkpointId: randomUUID(),
			ref: checkpointRef(kind, runningId, 1),
		},
		close: h.close,
	};
});

describe("core-engine module", () => {
	it("answers no_vcs for a restore without vcs.git@2", async () => {
		const h = await setup("slow");
		const runId = await pausedRun(engineOf(h.registry));
		const ref = `refs/mete/checkpoints/${runId}/1`;
		const r = await restoreOf(h.registry).restore({
			runId,
			checkpointId: randomUUID(),
			ref,
		});
		expect(r.ok ? undefined : r.error.code).toBe("no_vcs");
		await h.close();
	});

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

	it("leaves running rows alone when recovery is off", async () => {
		const h = await setup("slow");
		const engine = engineOf(h.registry);
		const started = await engine.start({ goal: "wait" });
		if (!started.ok) throw new Error(started.error.message);
		const reader = createCoreEngineModule({
			workspaceId: randomUUID(),
			recover: false,
		});
		const sql = h.registry.resolve<StorageSqlAdapter>("storage.sql@1");
		if (!sql.ok) throw new Error("storage.sql@1 missing");
		const ctx = {
			...h.base,
			storage: sql.value[0].impl.scopeFor("core-engine"),
			disposables: { add() {}, dispose() {} },
		};
		const registry = createCapabilityRegistry(() => []);
		expect((await reader.activate({ ...ctx, capabilities: registry })).ok).toBe(
			true,
		);
		const other = engineOf(registry).status(started.value.runId);
		expect(other.ok && other.value[0]?.status).toBe("running");
		await reader.deactivate();
		await h.close();
	});

	it("pauses its running runs and stops providing team.engine@2 on deactivate", async () => {
		const h = await setup("slow");
		const engine = engineOf(h.registry);
		const started = await engine.start({ goal: "wait" });
		if (!started.ok) throw new Error(started.error.message);
		await h.close();
		expect(h.registry.has("team.engine@2")).toBe(false);
		expect(h.events.map((e) => e.type)).toEqual([
			"run.created",
			"run.started",
			"run.paused",
		]);
	});
});
