import { randomUUID } from "node:crypto";
import type { Migration, Tier } from "@mete/contracts";
import type BetterSqlite3 from "better-sqlite3";
import { lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// One row per provider call in the workspace database, for replay (docs/07, model_calls).

/** The gateway's own schema; the Drizzle table below mirrors it. */
export const MODEL_CALL_MIGRATIONS: ReadonlyArray<Migration> = [
	{
		id: "001-model-calls",
		sql: `CREATE TABLE model_calls (
			id TEXT PRIMARY KEY,
			ts TEXT NOT NULL,
			run_id TEXT NOT NULL,
			provider_id TEXT NOT NULL,
			model_id TEXT NOT NULL,
			tier TEXT,
			request TEXT NOT NULL,
			response TEXT NOT NULL,
			prompt_tokens INTEGER NOT NULL,
			completion_tokens INTEGER NOT NULL,
			latency_ms INTEGER NOT NULL,
			outcome TEXT NOT NULL
		);
		CREATE INDEX model_calls_run_ts ON model_calls (run_id, ts)`,
	},
];

const modelCalls = sqliteTable("model_calls", {
	id: text("id").primaryKey(),
	ts: text("ts").notNull(),
	runId: text("run_id").notNull(),
	providerId: text("provider_id").notNull(),
	modelId: text("model_id").notNull(),
	tier: text("tier"),
	request: text("request", { mode: "json" }).notNull(),
	response: text("response", { mode: "json" }).notNull(),
	promptTokens: integer("prompt_tokens").notNull(),
	completionTokens: integer("completion_tokens").notNull(),
	latencyMs: integer("latency_ms").notNull(),
	outcome: text("outcome").notNull(),
});

/** One provider call; `request` holds the masked messages and tools as sent. */
export type ModelCall = {
	readonly ts: string;
	readonly runId: string;
	readonly providerId: string;
	readonly modelId: string;
	readonly tier: Tier | null;
	readonly request: unknown;
	readonly response: unknown;
	readonly promptTokens: number;
	readonly completionTokens: number;
	readonly latencyMs: number;
	/** The finish reason or the error code. */
	readonly outcome: string;
};

/** Writes model_calls rows and deletes those older than a cut-off. */
export const createModelCallLog = (
	db: BetterSqlite3.Database,
	newId: () => string = randomUUID,
) => {
	const orm = drizzle(db);
	return {
		write: (call: ModelCall) => {
			orm
				.insert(modelCalls)
				.values({ id: newId(), ...call })
				.run();
		},
		/** Deletes rows written before `cutoff` (ISO 8601). */
		prune: (cutoff: string) => {
			orm.delete(modelCalls).where(lt(modelCalls.ts, cutoff)).run();
		},
	};
};
