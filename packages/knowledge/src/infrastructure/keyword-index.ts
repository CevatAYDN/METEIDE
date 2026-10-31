import type { Migration, NoteType } from "@mete/contracts";
import type BetterSqlite3 from "better-sqlite3";
import { inArray, isNotNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
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
	// What aging reads of each note (ADR-173); emptied shas index every note again, so its facts are read.
	{
		id: "003-knowledge-aging",
		sql: `ALTER TABLE knowledge_files ADD COLUMN type TEXT;
ALTER TABLE knowledge_files ADD COLUMN born TEXT;
ALTER TABLE knowledge_files ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
UPDATE knowledge_files SET sha = '';`,
	},
];

const files = sqliteTable("knowledge_files", {
	path: text("path").primaryKey(),
	sha: text("sha").notNull(),
	type: text("type").$type<NoteType>(),
	born: text("born"),
	pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
});

/** A note's type, its frontmatter `created` (else `updated`) and its pin, as aging reads them (ADR-173). */
export type NoteAge = {
	readonly type: NoteType;
	readonly born?: string;
	readonly pinned: boolean;
};

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
	readonly rowid: number;
	readonly path: string;
	readonly type: NoteType;
	readonly title: string;
	readonly heading: string;
	readonly snippet: string;
};

/** An indexed section with its whole text, which the vector source embeds (ADR-152). */
export type Chunk = Omit<IndexRow, "snippet"> & { readonly body: string };

// The caller's type and folder filters.
const within = (q: Pick<Query, "type" | "path">) =>
	sql`(${q.type ?? null} IS NULL OR type = ${q.type ?? null})
		AND (${q.path ?? null} IS NULL OR substr(path, 1, length(${q.path ?? null})) = ${q.path ?? null})`;

/** The keyword index over one workspace database. */
export type KeywordIndex = ReturnType<typeof keywordIndex>;

type Orm = ReturnType<typeof drizzle>;

// A note's sections and its row of knowledge_files.
const put = (tx: Pick<Orm, "run" | "insert">, n: IndexedNote) => {
	for (const s of n.facts ? n.sections : [])
		tx.run(sql`INSERT INTO knowledge_chunks VALUES (${n.path}, 'workspace',
			${n.facts?.type}, ${n.facts?.title}, ${s.heading ?? ""}, ${s.text})`);
	const row = {
		sha: n.sha,
		type: n.facts?.type ?? null,
		born: n.facts?.born ?? null,
		pinned: n.facts?.pinned ?? false,
	};
	tx.insert(files)
		.values({ path: n.path, ...row })
		.onConflictDoUpdate({ target: files.path, set: row })
		.run();
};

// Every indexed note's type, when it was written and whether it is pinned, by path (ADR-173).
const agesOf = (orm: Orm): Map<string, NoteAge> =>
	new Map(
		orm
			.select()
			.from(files)
			.where(isNotNull(files.type))
			.all()
			.flatMap(({ path, type, born, pinned }) =>
				type ? [[path, { type, pinned, ...(born ? { born } : {}) }]] : [],
			),
	);

export const keywordIndex = (db: BetterSqlite3.Database) => {
	const orm = drizzle(db);
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
		/** Every indexed note's type, when it was written and whether it is pinned, by path. */
		ages: () => agesOf(orm),
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
		/** The best sections first: BM25, then path, so equal scores keep one order. The snippet is
		 * always of the body (column 5), not of a title or heading the word matched (docs/11). */
		search: (q: Query): IndexRow[] =>
			orm.all<IndexRow>(sql`SELECT rowid, path, type, title, heading,
				snippet(knowledge_chunks, 5, '', '', '…', ${SNIPPET_TOKENS}) AS snippet
				FROM knowledge_chunks WHERE knowledge_chunks MATCH ${q.match} AND ${within(q)}
				ORDER BY bm25(knowledge_chunks), path LIMIT ${q.k}`),
		/** Every indexed section under the filters, in the index's order. */
		chunks: (q: Pick<Query, "type" | "path">): Chunk[] =>
			orm.all<Chunk>(sql`SELECT rowid, path, type, title, heading, body
				FROM knowledge_chunks WHERE ${within(q)}`),
	};
};
