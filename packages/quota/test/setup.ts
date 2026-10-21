import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	MeteEvent,
	QuotaReserveAdapter,
	StorageSqlAdapter,
} from "@mete/contracts";
import {
	createCapabilityRegistry,
	createConfigReader,
	createEventBus,
	type ModuleContext,
} from "@mete/kernel";
import { createStorageModule } from "@mete/storage";
import { afterAll } from "vitest";
import { createQuotaModule } from "../src/module.js";

// Real storage and SQLite in a temp folder, as docs/15 asks of integration tests,
// with a fake clock whose timers run when time is advanced.
const roots: string[] = [];
afterAll(async () => {
	await Promise.all(roots.map((r) => rm(r, { recursive: true, force: true })));
});

export const WORKSPACE = "00000000-0000-4000-8000-0000000000ff";
export const T0 = Date.parse("2026-10-21T12:00:00Z");

const clock = () => {
	let t = T0;
	let timers: { at: number; fn: () => void }[] = [];
	return {
		now: () => t,
		setTimer: (fn: () => void, ms: number) => {
			const timer = { at: t + ms, fn };
			timers.push(timer);
			return () => {
				timers = timers.filter((x) => x !== timer);
			};
		},
		advance(ms: number) {
			t += ms;
			const due = timers.filter((x) => x.at <= t);
			timers = timers.filter((x) => x.at > t);
			for (const x of due) x.fn();
		},
		pending: () => timers.length,
	};
};

/** A folder pair that several module instances can open in turn. */
export const folders = async () => {
	const root = await mkdtemp(join(tmpdir(), "mete-quota-"));
	roots.push(root);
	return { workspaceDir: join(root, "repo"), globalDir: join(root, "global") };
};

/** A quota module over real storage; `quota` is the workspace quota.yaml content. */
export const setup = async (
	dirs: { workspaceDir: string; globalDir: string },
	quota: unknown = {},
) => {
	const time = clock();
	const events: MeteEvent[] = [];
	const registry = createCapabilityRegistry(() => []);
	const bus = createEventBus((e) => {
		throw e;
	});
	bus.subscribe("quota.*", (e) => {
		events.push(e);
	});
	const log = () => {};
	const base = {
		capabilities: registry,
		events: bus,
		config: createConfigReader({
			global: { file: join(dirs.globalDir, "settings.yaml"), sections: {} },
			workspace: {
				quota: {
					file: join(dirs.workspaceDir, ".mete", "quota.yaml"),
					value: quota,
				},
			},
		}),
		logger: { error: log, warn: log, info: log, debug: log },
		disposables: { add: () => {}, dispose: () => {} },
	} satisfies ModuleContext;
	const storage = createStorageModule(dirs);
	await storage.activate(base);
	const sql = registry.resolve<StorageSqlAdapter>("storage.sql@1");
	if (!sql.ok) throw new Error("storage.sql@1 missing");
	const ctx: ModuleContext = {
		...base,
		storage: sql.value[0].impl.scopeFor("quota"),
	};
	const quotaModule = createQuotaModule({
		workspaceId: WORKSPACE,
		now: time.now,
		setTimer: time.setTimer,
	});
	const adapter = () => {
		const r = registry.resolve<QuotaReserveAdapter>("quota.reserve@1");
		if (!r.ok) throw new Error("quota.reserve@1 missing");
		return r.value[0].impl;
	};
	const close = async () => {
		await quotaModule.deactivate();
		await storage.deactivate();
	};
	return { base, ctx, quotaModule, adapter, events, time, close };
};
