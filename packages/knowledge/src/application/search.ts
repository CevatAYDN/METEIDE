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
import { ftsQuery, noteFacts, sectionsOf } from "../domain/index-text.js";
import { VAULT } from "../domain/note.js";
import { splitNote } from "../infrastructure/frontmatter.js";
import type {
	IndexedNote,
	IndexRow,
	KeywordIndex,
	Query,
} from "../infrastructure/keyword-index.js";

// knowledge.search@1 (docs/11, Hybrid search; ADR-149): before each search the vault's notes are
// read through fs.glob@1 and fs.read@1, so .meteignore applies, and the changed ones indexed again.

type Out<T> = Promise<Result<T, ToolError>>;

/** What the search needs from its module. */
export type SearchDeps = {
	readonly registry: CapabilityRegistry;
	readonly index: KeywordIndex;
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

// A note as the index stores it; a frontmatter that is not a map leaves the whole text as body.
const indexed = (path: string, sha: string, text: string): IndexedNote => {
	const { data, body } = splitNote(text) ?? { data: {}, body: text };
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
	deps.index.update(
		changed.map((n) => indexed(n.path, n.sha, n.text)),
		[...known.keys()].filter((p) => !kept.has(p)),
	);
	return ok(undefined);
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

// The search an input asks for, or why it asks for none.
const queryOf = (input: unknown): Result<Query, ToolError> => {
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
		const rows = deps.index.search(q.value);
		return ok({ results: rows.map((r, n) => hitOf(r, n + 1)) });
	};
