import type BetterSqlite3 from "better-sqlite3";
import type { MeteEvent } from "./events.js";
import type { Result } from "./result.js";

// storage.sql@1 from docs/06-kernel-and-modules.md (Kernel API).
// Each module owns unique table names; storage records applied migrations per module id
// in its own `storage_migrations` table, so ledgers never collide.

/** One schema step; applied once, in array order, each in a transaction. */
export type Migration = { readonly id: string; readonly sql: string };

/** A migration that failed; `message` is for logs, users see i18n text. */
export type MigrationError = {
	readonly code: "migration_failed";
	readonly moduleId: string;
	readonly migrationId: string;
	readonly message: string;
};

/** Which database: the workspace `.mete/mete.db` or the global one. */
export type StorageScope = "workspace" | "global";

/** A module's view of storage.sql@1; wrap a handle with drizzle() to query it. */
export interface ScopedStorage {
	readonly workspace: BetterSqlite3.Database;
	readonly global: BetterSqlite3.Database;
	migrate(
		scope: StorageScope,
		migrations: ReadonlyArray<Migration>,
	): Result<void, MigrationError>;
}

/** The storage.sql@1 adapter; the composition root builds `ModuleContext.storage` with it. */
export interface StorageSqlAdapter {
	scopeFor(moduleId: string): ScopedStorage;
}

/** A persisted row that is no valid event any more; reported, never skipped in silence. */
export type BrokenEvent = { readonly seq: number; readonly issues: string };

/** One run's persisted catalog events in `seq` order, and the rows that no longer parse. */
export type RunEvents = {
	readonly events: readonly MeteEvent[];
	readonly broken: readonly BrokenEvent[];
};

/** The events.read@1 adapter of the storage module (docs/06, Capability catalog; ADR-144). */
export interface EventsReadAdapter {
	read(runId: string): RunEvents;
}
