import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type MeteEvent, ok, type StorageSqlAdapter } from "@mete/contracts";
import {
	createCapabilityRegistry,
	createEventBus,
	type ModuleContext,
} from "@mete/kernel";
import { afterAll, describe, expect, it } from "vitest";
import { EVENT_RETENTION_DAYS } from "../src/defaults.js";
import { createStorageModule } from "../src/module.js";

const DAY = 86_400_000;
const roots: string[] = [];
afterAll(async () => {
	await Promise.all(roots.map((r) => rm(r, { recursive: true, force: true })));
});

const setup = async () => {
	const root = await mkdtemp(join(tmpdir(), "mete-storage-"));
	roots.push(root);
	const registry = createCapabilityRegistry(() => []);
	const events = createEventBus((e) => {
		throw e;
	});
	const items: { dispose: () => void }[] = [];
	const log = () => {};
	const ctx: ModuleContext = {
		capabilities: registry,
		events,
		config: { get: () => ok(undefined as never) },
		logger: { error: log, warn: log, info: log, debug: log },
		disposables: {
			add: (d) => items.push(d),
			dispose: () => {
				for (const d of items.splice(0)) d.dispose();
			},
		},
	};
	const dirs = {
		workspaceDir: join(root, "repo"),
		globalDir: join(root, "global"),
	};
	const adapter = () => {
		const r = registry.resolve<StorageSqlAdapter>("storage.sql@1");
		if (!r.ok) throw new Error("storage.sql@1 missing");
		return r.value[0].impl;
	};
	return { root, ctx, events, registry, dirs, adapter };
};

const runStarted = (ts = new Date().toISOString()): MeteEvent => ({
	id: crypto.randomUUID(),
	ts,
	schema: 1,
	workspaceId: crypto.randomUUID(),
	runId: crypto.randomUUID(),
	source: "core-engine",
	type: "run.started",
	payload: {},
});

describe("storage module", () => {
	it("persists every published event with its order", async () => {
		const s = await setup();
		const mod = createStorageModule(s.dirs);
		expect(await mod.activate(s.ctx)).toEqual({ ok: true, value: undefined });
		const event = runStarted();
		s.events.publish(event);
		const rows = s
			.adapter()
			.scopeFor("core-engine")
			.workspace.prepare("SELECT seq, id, type, run_id, payload FROM events")
			.all();
		expect(rows).toEqual([
			{
				seq: 1,
				id: event.id,
				type: "run.started",
				run_id: event.runId,
				payload: "{}",
			},
		]);
		await mod.deactivate();
	});

	it("lets a module migrate its own tables in either database", async () => {
		const s = await setup();
		const mod = createStorageModule(s.dirs);
		await mod.activate(s.ctx);
		const quota = s.adapter().scopeFor("quota");
		const r = quota.migrate("global", [
			{ id: "001", sql: "CREATE TABLE quota_units (id TEXT PRIMARY KEY)" },
		]);
		expect(r.ok).toBe(true);
		expect(
			quota.global
				.prepare("SELECT module_id, id FROM storage_migrations")
				.all(),
		).toEqual([{ module_id: "quota", id: "001" }]);
		await mod.deactivate();
	});

	it("deletes events past the retention when it activates", async () => {
		const s = await setup();
		const now = Date.now();
		const first = createStorageModule(s.dirs);
		await first.activate(s.ctx);
		const old = runStarted(
			new Date(now - (EVENT_RETENTION_DAYS + 1) * DAY).toISOString(),
		);
		const recent = runStarted(new Date(now - DAY).toISOString());
		s.events.publish(old);
		s.events.publish(recent);
		await first.deactivate();
		s.ctx.disposables.dispose();

		const second = createStorageModule({ ...s.dirs, now: () => now });
		await second.activate(s.ctx);
		const ids = s
			.adapter()
			.scopeFor("core-engine")
			.workspace.prepare("SELECT id FROM events")
			.pluck()
			.all();
		expect(ids).toEqual([recent.id]);
		await second.deactivate();
	});

	it("closes its databases and stops capturing on deactivate", async () => {
		const s = await setup();
		const mod = createStorageModule(s.dirs);
		await mod.activate(s.ctx);
		const scope = s.adapter().scopeFor("quota");
		await mod.deactivate();
		expect(scope.workspace.open).toBe(false);
		expect(scope.global.open).toBe(false);
		expect(() => s.events.publish(runStarted())).not.toThrow();
	});

	it("fails activation when a database cannot be opened", async () => {
		const s = await setup();
		await writeFile(join(s.root, "a-file"), "");
		const mod = createStorageModule({
			...s.dirs,
			globalDir: join(s.root, "a-file"),
		});
		const r = await mod.activate(s.ctx);
		expect(r.ok ? undefined : r.error).toMatchObject({
			code: "activation_failed",
			moduleId: "storage",
		});
		expect(s.registry.has("storage.sql@1")).toBe(false);
	});
});
