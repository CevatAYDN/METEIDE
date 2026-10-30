import { createHash } from "node:crypto";
import { err, type Migration, ok, type Result } from "@mete/contracts";
import type BetterSqlite3 from "better-sqlite3";
import { desc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { VECTOR_MAX_DISTANCE } from "../defaults.js";

// The vector source's storage (docs/11, Hybrid search; ADR-152): one sqlite-vec table per embedding
// model, each vector under its cache key, the SHA-256 of its section's text and the model id (docs/11,
// Indexing). The registry of models is a migration; a model's vec0 table is created at its first
// answer, the one CREATE outside the migrations, because the ADR sizes the table by that answer.

/** The registry of embedding models; the Drizzle table below mirrors it. */
export const VECTOR_MIGRATIONS: ReadonlyArray<Migration> = [
	{
		id: "002-knowledge-vectors",
		sql: `CREATE TABLE knowledge_vec_models (
	model TEXT PRIMARY KEY, tbl TEXT NOT NULL UNIQUE, dim INTEGER NOT NULL, used INTEGER NOT NULL
);`,
	},
];

const models = sqliteTable("knowledge_vec_models", {
	model: text("model").primaryKey(),
	tbl: text("tbl").notNull(),
	dim: integer("dim").notNull(),
	used: integer("used").notNull(),
});

/** The cache key of a section's vector: its text and the model that embeds it (docs/11, Indexing). */
export const cacheKey = (text: string, model: string) =>
	createHash("sha256").update(`${text}\n${model}`).digest("hex");

/** A section's vector under its cache key. */
export type Keyed = {
	readonly key: string;
	readonly vector: readonly number[];
};

type Orm = ReturnType<typeof drizzle>;
type Tx = Pick<Orm, "run" | "select">;

// sqlite-vec answers vec_version() once loaded; the storage module loads it into each database (S4a).
const loaded = (db: BetterSqlite3.Database) => {
	try {
		db.prepare("SELECT vec_version()").get();
		return true;
	} catch {
		return false;
	}
};

const tableOf = (orm: Pick<Orm, "select">, model: string) =>
	orm.select().from(models).where(eq(models.model, model)).get()?.tbl;

// A model's table, made at its first answer with that answer's size; `used` orders the answers.
const ensure = (tx: Tx, model: string, dim: number) => {
	const known = tableOf(tx, model);
	const used = sql`(SELECT coalesce(max(used), 0) + 1 FROM knowledge_vec_models)`;
	if (known) {
		tx.run(
			sql`UPDATE knowledge_vec_models SET used = ${used} WHERE model = ${model}`,
		);
		return known;
	}
	const n = tx.select({ n: sql<number>`count(*)` }).from(models).get()?.n ?? 0;
	const tbl = `knowledge_vec_${n + 1}`;
	tx.run(
		sql`CREATE VIRTUAL TABLE ${sql.identifier(tbl)} USING vec0(key TEXT PRIMARY KEY, embedding float[${sql.raw(String(dim))}] distance_metric=cosine)`,
	);
	tx.run(
		sql`INSERT INTO knowledge_vec_models VALUES (${model}, ${tbl}, ${dim}, ${used})`,
	);
	return tbl;
};

const keysIn = (orm: Orm, tbl: string | undefined, keys: readonly string[]) => {
	if (!tbl) return new Set<string>();
	const rows = orm.all<{ key: string }>(
		sql`SELECT key FROM ${sql.identifier(tbl)} WHERE key IN (SELECT value FROM json_each(${JSON.stringify(keys)}))`,
	);
	return new Set(rows.map((r) => r.key));
};

const insert = (
	orm: Orm,
	model: string,
	rows: readonly Keyed[],
): Result<void, string> => {
	const dim = rows[0]?.vector.length;
	if (!dim) return ok(undefined);
	const known = keysIn(
		orm,
		tableOf(orm, model),
		rows.map((r) => r.key),
	);
	const fresh = [...new Map(rows.map((r) => [r.key, r])).values()].filter(
		(r) => !known.has(r.key),
	);
	try {
		orm.transaction((tx) => {
			const tbl = sql.identifier(ensure(tx, model, dim));
			for (const r of fresh)
				tx.run(
					sql`INSERT INTO ${tbl}(key, embedding) VALUES (${r.key}, ${new Float32Array(r.vector)})`,
				);
		});
		return ok(undefined);
	} catch (e) {
		return err(e instanceof Error ? e.message : String(e));
	}
};

// A query vector comes from a provider; one of another size than the table's finds nothing, and
// so does a vector farther than VECTOR_MAX_DISTANCE from every stored one (docs/11).
const knn = (
	orm: Orm,
	tbl: string | undefined,
	vector: readonly number[],
	k: number,
) => {
	if (!tbl) return [];
	try {
		return orm
			.all<{ key: string; distance: number }>(
				sql`SELECT key, distance FROM ${sql.identifier(tbl)} WHERE embedding MATCH ${new Float32Array(vector)} AND k = ${k} ORDER BY distance`,
			)
			.filter((r) => r.distance <= VECTOR_MAX_DISTANCE)
			.map((r) => r.key);
	} catch {
		return [];
	}
};

/** The vector index over one workspace database. */
export type VectorIndex = ReturnType<typeof vectorIndex>;

export const vectorIndex = (db: BetterSqlite3.Database) => {
	const available = loaded(db);
	const orm = drizzle(db);
	const tbl = (model: string) => (available ? tableOf(orm, model) : undefined);
	return {
		available,
		/** The model that answered last, whose vectors the background job keeps up to date. */
		latest: () =>
			available
				? orm.select().from(models).orderBy(desc(models.used)).limit(1).get()
						?.model
				: undefined,
		/** Of these keys, those the model has a vector for. */
		stored: (model: string, keys: readonly string[]) =>
			keysIn(orm, tbl(model), keys),
		/** Stores one model's vectors, each key once; a vector of another size refuses the whole batch. */
		put: (model: string, rows: readonly Keyed[]): Result<void, string> =>
			available ? insert(orm, model, rows) : err("sqlite-vec is not loaded"),
		/** The keys of the model's vectors nearest to `vector`, nearest first; none without its table, of another size or far from them. */
		nearest: (model: string, vector: readonly number[], k: number): string[] =>
			knn(orm, tbl(model), vector, k),
	};
};
