// MeteModule entry (docs/06-kernel-and-modules.md). Modules in this package: quota.
import {
	err,
	type ModuleManifest,
	ok,
	QuotaConfigSchema,
} from "@mete/contracts";
import type {
	Disposable,
	MeteModule,
	ModuleContext,
	ModuleError,
} from "@mete/kernel";
import { createQuotaReserve, type Emit } from "./application/quota-reserve.js";
import {
	createScheduler,
	type SchedulerOptions,
} from "./application/scheduler.js";
import { createPool } from "./domain/pool.js";
import {
	createQuotaStore,
	QUOTA_MIGRATIONS,
} from "./infrastructure/quota-store.js";

/** What the composition root passes; clock and timer are injectable for tests. */
export type QuotaOptions = {
	readonly workspaceId: string;
	readonly now?: () => number;
	readonly setTimer?: SchedulerOptions["setTimer"];
};

const MANIFEST: ModuleManifest = {
	id: "quota",
	version: "0.0.0",
	displayName: "Quota",
	class: "essential",
	trust: "core",
	provides: ["quota.reserve@4"],
	requires: ["storage.sql@1"],
	optional: [],
	activation: ["onStartup"],
	isolation: "in-process",
	permissions: [],
};

const failed = (message: string): ModuleError => ({
	code: "activation_failed",
	moduleId: MANIFEST.id,
	message,
});

// setTimeout fires at once above 2^31 - 1 ms, and a month window can be longer.
const MAX_DELAY_MS = 2_147_483_647;
const realTimer: SchedulerOptions["setTimer"] = (fn, ms) => {
	const t = setTimeout(fn, Math.min(ms, MAX_DELAY_MS));
	return () => clearTimeout(t);
};

const emitter =
	(ctx: ModuleContext, workspaceId: string, now: () => number): Emit =>
	(body, runId) =>
		ctx.events.publish({
			id: crypto.randomUUID(),
			ts: new Date(now()).toISOString(),
			schema: 1,
			workspaceId,
			...(runId === undefined ? {} : { runId }),
			source: MANIFEST.id,
			...body,
		});

// The pool with the settings limits and the usage saved by earlier processes.
const openPool = (ctx: ModuleContext, now: () => number) => {
	if (!ctx.storage) return err("storage.sql@1 was not provided");
	const migrated = ctx.storage.migrate("global", QUOTA_MIGRATIONS);
	if (!migrated.ok) return err(migrated.error.message);
	const config = ctx.config.get("quota", QuotaConfigSchema);
	if (!config.ok) {
		const { file, path, reason } = config.error;
		return err(`${file} ${path}: ${reason}`);
	}
	const { limits } = config.value;
	const pool = createPool({
		settingsLimit: (providerId, unit) =>
			limits.find((l) => l.providerId === providerId && l.unit === unit)?.limit,
	});
	const store = createQuotaStore(ctx.storage.global, now);
	try {
		// shortcut: saved usage is read once, so the CLI and the daemon running at the
		// same time each count alone; read the window from the database in check() then.
		pool.load(store.load());
	} catch (error) {
		return err(`saved quota could not be read: ${String(error)}`);
	}
	return ok({ pool, store });
};

/** Creates the quota module, which provides quota.reserve@4. */
export const createQuotaModule = (opts: QuotaOptions): MeteModule => {
	const now = opts.now ?? Date.now;
	let created: { dispose: () => void }[] = [];
	return {
		manifest: MANIFEST,
		async activate(ctx) {
			const opened = openPool(ctx, now);
			if (!opened.ok) return err(failed(opened.error));
			const { pool, store } = opened.value;
			const setTimer = opts.setTimer ?? realTimer;
			const scheduler = createScheduler({ pool, now, setTimer });
			const reserve = createQuotaReserve({
				pool,
				scheduler,
				store,
				emit: emitter(ctx, opts.workspaceId, now),
				logger: ctx.logger,
				now,
				setTimer,
			});
			const core = { id: MANIFEST.id, trust: "core", features: [] } as const;
			const provided: Disposable = ctx.capabilities.provide("quota.reserve@4", {
				...core,
				impl: reserve.adapter,
			});
			ctx.disposables.add(provided);
			created = [provided, reserve];
			return ok(undefined);
		},
		async deactivate() {
			for (const d of created.splice(0)) d.dispose();
		},
	};
};
