import { createHash } from "node:crypto";
import {
	err,
	type FsPathsOutput,
	type FsReadOutput,
	type KnowledgeHit,
	KnowledgeSearchInputSchema,
	type KnowledgeSearchOutput,
	ok,
	type Result,
	type ToolAdapter,
	type ToolContext,
	type ToolError,
} from "@mete/contracts";
import type { CapabilityRegistry } from "@mete/kernel";
import { fuse } from "../domain/fusion.js";
import { ftsQuery, noteFacts, sectionsOf } from "../domain/index-text.js";
import { VAULT } from "../domain/note.js";
import { isCold } from "../domain/retention.js";
import type { AccessLog } from "../infrastructure/access-log.js";
import { splitNote } from "../infrastructure/frontmatter.js";
import type {
	Chunk,
	IndexedNote,
	IndexRow,
	Query,
} from "../infrastructure/keyword-index.js";
import { nearSections, type VectorDeps, vectorHit } from "./vector-source.js";

// knowledge.search@1 (docs/11, Hybrid search; ADR-149, ADR-152): before each search the vault's notes
// are read through fs.glob@1 and fs.read@1, so .meteignore applies, and the changed ones indexed
// again; then the background job embeds what changed, and the keyword and vector ranks are fused.

type Out<T> = Promise<Result<T, ToolError>>;

/** What the search needs from its module; `now` is the clock aging reads. */
export type SearchDeps = VectorDeps & {
	readonly registry: CapabilityRegistry;
	readonly access: AccessLog;
	readonly now: () => number;
};

const bad = (message: string) => err<ToolError>({ code: "bad_input", message });

// The workspace vault, never the task's worktree, as the vault tools read it (ADR-145).
const inWorkspace = ({ cwd: _cwd, ...rest }: ToolContext): ToolContext => rest;

const fsTool = <O>(deps: SearchDeps, ref: "fs.glob@1" | "fs.read@1") => {
	const chain = deps.registry.resolve<ToolAdapter<unknown, O>>(ref);
	return chain.ok ? chain.value[0].impl : undefined;
};

// The vault's notes by their path in the vault; none without a vault folder. Like every fs tool the
// listing follows .gitignore (ADR-040), so a workspace that ignores .mete/ has no notes to search.
const listNotes = async (deps: SearchDeps, ctx: ToolContext): Out<string[]> => {
	const glob = fsTool<FsPathsOutput>(deps, "fs.glob@1");
	if (!glob) return err({ code: "io", message: "fs.glob@1 is not active" });
	const r = await glob.run({ pattern: "**/*.md", path: VAULT }, ctx);
	if (!r.ok) return r.error.code === "not_found" ? ok([]) : r;
	const prefix = `${VAULT}/`;
	return ok(
		r.value.paths
			.filter((p) => p.startsWith(prefix))
			.map((p) => p.slice(prefix.length))
			.filter((p) => !p.startsWith(".history/")),
	);
};

// Invalid frontmatter must not hide a private flag; an excluded note also loses its old sections.
const indexed = (path: string, sha: string, text: string): IndexedNote => {
	const parts = splitNote(text);
	if (!parts) return { path, sha, sections: [] };
	const { data, body } = parts;
	const facts = noteFacts(path, data, body);
	return facts
		? { path, sha, facts, sections: sectionsOf(body) }
		: { path, sha, sections: [] };
};

// Reads every note and indexes the changed ones again; a note that cannot be read counts as gone.
// shortcut: every note is read on each search, fine for hundreds of notes; a watcher when code joins the index (docs/11 Indexing).
const refresh = async (deps: SearchDeps, ctx: ToolContext): Out<void> => {
	const listed = await listNotes(deps, ctx);
	if (!listed.ok) return listed;
	const read = fsTool<FsReadOutput>(deps, "fs.read@1");
	if (!read) return err({ code: "io", message: "fs.read@1 is not active" });
	const known = deps.index.shas();
	const notes = await Promise.all(
		listed.value.map(async (path) => {
			const r = await read.run({ path: `${VAULT}/${path}` }, ctx);
			if (!r.ok) return undefined;
			const sha = createHash("sha256").update(r.value.content).digest("hex");
			return { path, sha, text: r.value.content };
		}),
	);
	const present = notes.filter((n) => n !== undefined);
	const changed = present.filter((n) => known.get(n.path) !== n.sha);
	const kept = new Set(present.map((n) => n.path));
	const gone = [...known.keys()].filter((p) => !kept.has(p));
	deps.index.update(
		changed.map((n) => indexed(n.path, n.sha, n.text)),
		gone,
	);
	deps.access.drop(gone);
	return ok(undefined);
};

// The vault's cold notes, as their index facts and accesses stand now (ADR-173).
const coldPaths = (deps: SearchDeps) => {
	const ages = deps.index.ages();
	const seen = deps.access.of([...ages.keys()]);
	const now = deps.now();
	const cold = [...ages].filter(([path, age]) =>
		isCold({ ...age, accesses: 0, ...seen.get(path) }, now),
	);
	return new Set(cold.map(([path]) => path));
};

// docs/11: every warm hit before every cold one, each group in its order, then the best k, so a
// cold note never takes a warm one's place.
const warmFirst = <T extends { readonly path: string }>(
	cold: ReadonlySet<string>,
	hits: readonly T[],
	k: number,
) => {
	const isWarm = (h: T) => !cold.has(h.path);
	return [...hits.filter(isWarm), ...hits.filter((h) => !isWarm(h))].slice(
		0,
		k,
	);
};

const hitOf = (row: IndexRow, rank: number): KnowledgeHit => ({
	path: row.path,
	scope: "workspace",
	type: row.type,
	title: row.title,
	...(row.heading ? { heading: row.heading } : {}),
	snippet: row.snippet,
	sources: { keyword: rank },
});

// The keyword hits keep their rank and FTS5 snippet; a section only the vector source found has none.
const fused = (
	rows: readonly IndexRow[],
	near: readonly Chunk[],
	k: number,
) => {
	const kw = new Map(rows.map((r, n) => [String(r.rowid), hitOf(r, n + 1)]));
	const vec = new Map(near.map((c) => [String(c.rowid), c]));
	return fuse([...kw.keys()], [...vec.keys()], k).flatMap((id) => {
		const c = vec.get(id);
		return kw.get(id) ?? (c ? vectorHit(c) : []);
	});
};

// The search an input asks for, with the query's own words for the vector source, or why it asks for none.
const queryOf = (
	input: unknown,
): Result<Query & { readonly text: string }, ToolError> => {
	const i = KnowledgeSearchInputSchema.safeParse(input);
	if (!i.success) return bad(i.error.message);
	if (i.data.scope === "personal")
		return err({
			code: "not_found",
			message: "No personal vault is set up yet; search the workspace vault",
		});
	const match = ftsQuery(i.data.query);
	if (!match) return bad("The query holds no word to search for");
	const { k, type, path } = i.data;
	return ok({
		text: i.data.query,
		match,
		k,
		...(type ? { type } : {}),
		...(path ? { path } : {}),
	});
};

/** knowledge.search@1: the workspace vault's matching sections, best first. */
export const searchNotes =
	(deps: SearchDeps) =>
	async (input: unknown, ctx: ToolContext): Out<KnowledgeSearchOutput> => {
		const q = queryOf(input);
		if (!q.ok) return q;
		const fresh = await refresh(deps, inWorkspace(ctx));
		if (!fresh.ok) return fresh;
		deps.job.kick();
		// Each source gives its best k warm-first, so it fetches k more for every cold note (ADR-173).
		const cold = coldPaths(deps);
		const { k } = q.value;
		const pool = { ...q.value, k: k + cold.size };
		const rows = warmFirst(cold, deps.index.search(pool), k);
		const near = warmFirst(cold, await nearSections(deps, pool, ctx), k);
		const all = fused(rows, near, rows.length + near.length);
		const results = warmFirst(cold, all, k);
		deps.access.touch(
			results.map((h) => h.path),
			deps.now(),
		);
		return ok({ results });
	};
