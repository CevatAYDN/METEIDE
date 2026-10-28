// MeteModule entry (docs/06-kernel-and-modules.md). Modules in this package: storage.
import { join } from "node:path";
import {
	type EventsReadAdapter,
	err,
	type ModuleManifest,
	ok,
	type Result,
	type ScopedStorage,
	type StorageSqlAdapter,
} from "@mete/contracts";
import type { Disposable, MeteModule, ModuleError } from "@mete/kernel";
import {
	captureEvents,
	EVENT_MIGRATIONS,
	pruneEvents,
	readRunEvents,
} from "./infrastructure/event-log.js";
import {
	type Db,
	openDatabase,
	runMigrations,
} from "./infrastructure/sqlite.js";

/** Where the databases live; the composition root knows both folders. */
export type StorageOptions = {
	readonly workspaceDir: string;
	readonly globalDir: string;
	readonly now?: () => number;
};

const MANIFEST: ModuleManifest = {
	id: "storage",
	version: "0.0.0",
	displayName: "Storage",
	class: "essential",
	trust: "core",
	provides: ["storage.sql@1", "events.read@1"],
	requires: [],
	optional: [],
	activation: ["onStartup"],
	isolation: "in-process",
	permissions: ["fs.read", "fs.write"],
};

type Handles = { readonly workspace: Db; readonly global: Db };

const failed = (message: string): ModuleError => ({
	code: "activation_failed",
	moduleId: MANIFEST.id,
	message,
});

const openBoth = async (
	opts: StorageOptions,
): Promise<Result<Handles, ModuleError>> => {
	const opened: Db[] = [];
	try {
		opened.push(
			await openDatabase(join(opts.workspaceDir, ".mete", "mete.db")),
		);
		opened.push(await openDatabase(join(opts.globalDir, "mete.db")));
		const [workspace, global] = opened as [Db, Db];
		return ok({ workspace, global });
	} catch (e) {
		for (const db of opened) db.close();
		return err(failed(e instanceof Error ? e.message : String(e)));
	}
};

const scopeFor = (h: Handles, moduleId: string): ScopedStorage => ({
	workspace: h.workspace,
	global: h.global,
	migrate: (scope, migrations) => runMigrations(h[scope], moduleId, migrations),
});

/** Creates the storage module, which provides storage.sql@1, persists events and reads a run's back (events.read@1). */
export const createStorageModule = (opts: StorageOptions): MeteModule => {
	let handles: Handles | undefined;
	let created: Disposable[] = [];
	const close = () => {
		for (const d of created.splice(0)) d.dispose();
		handles?.workspace.close();
		handles?.global.close();
		handles = undefined;
	};
	return {
		manifest: MANIFEST,
		async activate(ctx) {
			const opened = await openBoth(opts);
			if (!opened.ok) return opened;
			const h = opened.value;
			handles = h;
			const ready = runMigrations(h.workspace, MANIFEST.id, EVENT_MIGRATIONS);
			if (!ready.ok) {
				close();
				return err(failed(ready.error.message));
			}
			pruneEvents(h.workspace, (opts.now ?? Date.now)());
			const impl: StorageSqlAdapter = { scopeFor: (id) => scopeFor(h, id) };
			const reader: EventsReadAdapter = {
				read: (runId) => readRunEvents(h.workspace, runId),
			};
			created = [
				ctx.capabilities.provide("storage.sql@1", {
					id: MANIFEST.id,
					trust: "core",
					features: [],
					impl,
				}),
				ctx.capabilities.provide("events.read@1", {
					id: MANIFEST.id,
					trust: "core",
					features: [],
					impl: reader,
				}),
				...captureEvents(h.workspace, ctx.events),
			];
			for (const d of created) ctx.disposables.add(d);
			return ok(undefined);
		},
		// Stops capturing before closing, so no event reaches a closed database.
		async deactivate() {
			close();
		},
	};
};
