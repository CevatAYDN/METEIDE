import type { Migration } from "@mete/contracts";
import type BetterSqlite3 from "better-sqlite3";
import { and, desc, eq, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";

// The handoffs table of docs/07 (ADR-041, docs/08 Run memory). Rows are kept forever; a
// handoff only moves from open to accepted or expired, never back.

/** core-engine's handoffs table, after the runs and agents tables. */
export const HANDOFF_MIGRATIONS: ReadonlyArray<Migration> = [
	{
		id: "002-handoffs",
		sql: `CREATE TABLE handoffs (
			id TEXT PRIMARY KEY,
			workspace_id TEXT NOT NULL,
			run_id TEXT NOT NULL,
			state TEXT NOT NULL,
			body TEXT NOT NULL,
			created_at TEXT NOT NULL,
			accepted_at TEXT,
			accepted_by_run_id TEXT
		);
		CREATE INDEX handoffs_state_created ON handoffs (state, created_at)`,
	},
];

const handoffs = sqliteTable("handoffs", {
	id: text("id").primaryKey(),
	workspaceId: text("workspace_id").notNull(),
	runId: text("run_id").notNull(),
	state: text("state").notNull(),
	body: text("body").notNull(),
	createdAt: text("created_at").notNull(),
	acceptedAt: text("accepted_at"),
	acceptedByRunId: text("accepted_by_run_id"),
});

/** One handoff row. */
export type HandoffRow = typeof handoffs.$inferSelect;

const open = (workspaceId: string) =>
	and(eq(handoffs.workspaceId, workspaceId), eq(handoffs.state, "open"));

/** Writes and accepts handoffs of one workspace database. */
export const createHandoffStore = (db: BetterSqlite3.Database) => {
	const orm = drizzle(db);
	return {
		/** A new open handoff; it expires the workspace's older open ones in the same transaction. */
		write(h: {
			id: string;
			workspaceId: string;
			runId: string;
			body: string;
			createdAt: string;
		}) {
			orm.transaction((tx) => {
				tx.update(handoffs)
					.set({ state: "expired" })
					.where(open(h.workspaceId))
					.run();
				tx.insert(handoffs)
					.values({ ...h, state: "open" })
					.run();
			});
		},
		/** The workspace's newest open handoff, if any. */
		newestOpen: (workspaceId: string): HandoffRow | undefined =>
			orm
				.select()
				.from(handoffs)
				.where(open(workspaceId))
				.orderBy(desc(handoffs.createdAt))
				.get(),
		/**
		 * Accepts one open handoff exactly once: of two runs that try, one gets it (false for the
		 * other). Accepting expires the open ones older than it (docs/08, Run memory).
		 */
		accept(h: HandoffRow, byRunId: string, at: string) {
			return orm.transaction((tx) => {
				const taken = tx
					.update(handoffs)
					.set({ state: "accepted", acceptedAt: at, acceptedByRunId: byRunId })
					.where(and(eq(handoffs.id, h.id), eq(handoffs.state, "open")))
					.run();
				if (taken.changes !== 1) return false;
				tx.update(handoffs)
					.set({ state: "expired" })
					.where(and(open(h.workspaceId), lt(handoffs.createdAt, h.createdAt)))
					.run();
				return true;
			});
		},
	};
};

/** The handoffs of one workspace database. */
export type HandoffStore = ReturnType<typeof createHandoffStore>;
