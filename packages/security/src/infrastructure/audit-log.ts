import type { Migration } from "@mete/contracts";
import type BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// The audit log from SECURITY.md (Audit log), in the workspace database.

/** Security's own schema; the Drizzle table below mirrors it. */
export const AUDIT_MIGRATIONS: ReadonlyArray<Migration> = [
	{
		id: "001-audit-log",
		sql: `CREATE TABLE audit_log (
			seq INTEGER PRIMARY KEY,
			ts TEXT NOT NULL,
			run_id TEXT,
			agent_id TEXT,
			action TEXT NOT NULL,
			capability TEXT NOT NULL,
			adapter_id TEXT NOT NULL,
			args_sha256 TEXT NOT NULL,
			verdict TEXT NOT NULL,
			rule TEXT NOT NULL,
			tainted INTEGER NOT NULL
		)`,
	},
];

/** One row per policy check. */
export const auditLog = sqliteTable("audit_log", {
	seq: integer("seq").primaryKey(),
	ts: text("ts").notNull(),
	runId: text("run_id"),
	agentId: text("agent_id"),
	action: text("action").notNull(),
	capability: text("capability").notNull(),
	adapterId: text("adapter_id").notNull(),
	argsSha256: text("args_sha256").notNull(),
	verdict: text("verdict").notNull(),
	rule: text("rule").notNull(),
	tainted: integer("tainted", { mode: "boolean" }).notNull(),
});

/** A row to write; `seq` comes from SQLite. */
export type AuditRow = Omit<typeof auditLog.$inferInsert, "seq">;

/** Returns a function that inserts one audit row synchronously. */
export const createAuditWriter = (db: BetterSqlite3.Database) => {
	const orm = drizzle(db);
	return (row: AuditRow) => {
		orm.insert(auditLog).values(row).run();
	};
};
