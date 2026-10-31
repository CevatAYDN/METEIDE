import type { Migration } from "@mete/contracts";
import type BetterSqlite3 from "better-sqlite3";
import { inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { ACCESS_GAP_MS } from "../defaults.js";

// How often a note was found or read, and when last (docs/11, Aging and restore; ADR-173), in the
// workspace database. The search module and the vault module both apply this one migration under
// their own module id, since the storage ledger is per module; the second finds the table there.

export const ACCESS_MIGRATION: Migration = {
	id: "knowledge-access-001",
	sql: "CREATE TABLE IF NOT EXISTS knowledge_access (path TEXT PRIMARY KEY, accesses INTEGER NOT NULL, last_access TEXT NOT NULL);",
};

const access = sqliteTable("knowledge_access", {
	path: text("path").primaryKey(),
	accesses: integer("accesses").notNull(),
	lastAccess: text("last_access").notNull(),
});

/** A note's counted accesses and the ISO time of the last one. */
export type Accesses = {
	readonly accesses: number;
	readonly lastAccess: string;
};

/** The access counts over one workspace database. */
export type AccessLog = ReturnType<typeof accessLog>;

export const accessLog = (db: BetterSqlite3.Database) => {
	const orm = drizzle(db);
	return {
		/** Counts one access of each note, unless its last counted one is under ACCESS_GAP_MS old. */
		touch: (paths: readonly string[], now: number) => {
			const at = new Date(now).toISOString();
			// Both sides are toISOString text, so they compare as times.
			const recent = new Date(now - ACCESS_GAP_MS).toISOString();
			orm.transaction((tx) => {
				for (const path of new Set(paths))
					tx.insert(access)
						.values({ path, accesses: 1, lastAccess: at })
						.onConflictDoUpdate({
							target: access.path,
							set: { accesses: sql`${access.accesses} + 1`, lastAccess: at },
							setWhere: sql`${access.lastAccess} <= ${recent}`,
						})
						.run();
			});
		},
		/** The counts of the notes named, by path; a note never counted is absent. */
		of: (paths: readonly string[]): Map<string, Accesses> =>
			paths.length === 0
				? new Map()
				: new Map(
						orm
							.select()
							.from(access)
							.where(inArray(access.path, [...paths]))
							.all()
							.map(({ path, ...a }) => [path, a]),
					),
		/** Forgets the notes that left the vault. */
		drop: (paths: readonly string[]) => {
			if (paths.length > 0)
				orm
					.delete(access)
					.where(inArray(access.path, [...paths]))
					.run();
		},
	};
};
