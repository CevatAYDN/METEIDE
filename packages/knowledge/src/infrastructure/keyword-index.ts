import type { Migration, NoteType } from "@mete/contracts";
import type BetterSqlite3 from "better-sqlite3";
import { inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { SNIPPET_TOKENS } from "../defaults.js";
import type { NoteFacts, Section } from "../domain/index-text.js";

// The keyword index in the workspace database (docs/11, Hybrid search; ADR-149): an FTS5 table of
// note sections and the SHA-256 of each note last indexed. FTS5 has no Drizzle builder, so its
// statements go through Drizzle's sql template.

/** The module's own schema; the Drizzle table below mirrors knowledge_files. */
export const INDEX_MIGRATIONS: ReadonlyArray<Migration> = [
	{
		id: "001-knowledge-index",
		sql: `CREATE TABLE knowledge_files (path TEXT PRIMARY KEY, sha TEXT NOT NULL);
CREATE VIRTUAL TABLE knowledge_chunks USING fts5(
	path UNINDEXED, scope UNINDEXED, type UNINDEXED, title, heading, body,
	tokenize = 'unicode61 remove_diacritics 2'
);`,
	},
];

const files = sqliteTable("knowledge_files", {
	path: text("path").primaryKey(),
	sha: text("sha").notNull(),
});

/** A note read from the vault; no facts for a note the index leaves out. */
export type IndexedNote = {
	readonly path: string;
	readonly sha: string;
	readonly facts?: NoteFacts;
	readonly sections: readonly Section[];
};

/** A search: an FTS5 match and the caller's filters. */
export type Query = {
	readonly match: string;
	readonly k: number;
	readonly type?: NoteType;
	readonly path?: string;
};

/** A matching section; heading is "" for the text before a note's first heading. */
export type IndexRow = {
	readonly path: string;
	readonly type: NoteType;
	readonly title: string;
	readonly heading: string;
	readonly snippet: string;
};

/** The keyword index over one workspace database. */
export type KeywordIndex = ReturnType<typeof keywordIndex>;

export const keywordIndex = (db: BetterSqlite3.Database) => {
	const orm = drizzle(db);
	const put = (tx: Pick<typeof orm, "run" | "insert">, n: IndexedNote) => {
		for (const s of n.facts ? n.sections : [])
			tx.run(sql`INSERT INTO knowledge_chunks VALUES (${n.path}, 'workspace',
				${n.facts?.type}, ${n.facts?.title}, ${s.heading ?? ""}, ${s.text})`);
		tx.insert(files)
			.values({ path: n.path, sha: n.sha })
			.onConflictDoUpdate({ target: files.path, set: { sha: n.sha } })
			.run();
	};
	return {
		/** The SHA-256 of each note indexed, by its path in the vault. */
		shas: () =>
			new Map(
				orm
					.select()
					.from(files)
					.all()
					.map((f) => [f.path, f.sha]),
			),
		/** Indexes the changed notes again and drops the gone ones, all in one transaction. */
		update: (changed: readonly IndexedNote[], gone: readonly string[]) =>
			orm.transaction((tx) => {
				for (const path of [...gone, ...changed.map((n) => n.path)])
					tx.run(sql`DELETE FROM knowledge_chunks WHERE path = ${path}`);
				if (gone.length > 0)
					tx.delete(files)
						.where(inArray(files.path, [...gone]))
						.run();
				for (const n of changed) put(tx, n);
			}),
		/** The best sections first: BM25, then path, so equal scores keep one order. */
		search: (q: Query): IndexRow[] =>
			orm.all<IndexRow>(sql`SELECT path, type, title, heading,
				snippet(knowledge_chunks, -1, '', '', '…', ${SNIPPET_TOKENS}) AS snippet
				FROM knowledge_chunks WHERE knowledge_chunks MATCH ${q.match}
				AND (${q.type ?? null} IS NULL OR type = ${q.type ?? null})
				AND (${q.path ?? null} IS NULL OR substr(path, 1, length(${q.path ?? null})) = ${q.path ?? null})
				ORDER BY bm25(knowledge_chunks), path LIMIT ${q.k}`),
	};
};
