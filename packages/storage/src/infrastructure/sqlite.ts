import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
	err,
	type Migration,
	type MigrationError,
	ok,
	type Result,
} from "@mete/contracts";
import { withLockRetry } from "@mete/kernel";
import Database from "better-sqlite3";
import { BUSY_TIMEOUT_MS } from "../defaults.js";

// SQLite access from docs/05 (Database) and docs/06 (storage.sql@1).

/** An open better-sqlite3 connection. */
export type Db = Database.Database;

/** Opens a database file in WAL mode with the busy timeout, creating its folder. */
export const openDatabase = async (file: string): Promise<Db> => {
	await withLockRetry(() => mkdir(dirname(file), { recursive: true }));
	const db = new Database(file);
	db.pragma("journal_mode = WAL");
	db.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
	return db;
};

const LEDGER = `CREATE TABLE IF NOT EXISTS storage_migrations (
	module_id TEXT NOT NULL,
	id TEXT NOT NULL,
	applied_at TEXT NOT NULL,
	PRIMARY KEY (module_id, id)
)`;

/** Applies a module's migrations that are not in its ledger yet, each in a transaction. */
export const runMigrations = (
	db: Db,
	moduleId: string,
	migrations: ReadonlyArray<Migration>,
): Result<void, MigrationError> => {
	let current = "";
	try {
		db.exec(LEDGER);
		const done = new Set(
			db
				.prepare("SELECT id FROM storage_migrations WHERE module_id = ?")
				.pluck()
				.all(moduleId),
		);
		const record = db.prepare(
			"INSERT INTO storage_migrations (module_id, id, applied_at) VALUES (?, ?, ?)",
		);
		for (const m of migrations.filter((m) => !done.has(m.id))) {
			current = m.id;
			db.transaction(() => {
				db.exec(m.sql);
				record.run(moduleId, m.id, new Date().toISOString());
			})();
		}
		return ok(undefined);
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		return err({
			code: "migration_failed",
			moduleId,
			migrationId: current,
			message,
		});
	}
};
