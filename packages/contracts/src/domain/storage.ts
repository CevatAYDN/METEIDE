import type BetterSqlite3 from "better-sqlite3";
import type { Result } from "./result.js";

// storage.sql@1 from docs/06-kernel-and-modules.md (Kernel API).
// A module prefixes its tables with `<moduleId>_`; storage keeps each module's applied
// migrations in `<moduleId>_migrations`, so ledgers never collide.

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
