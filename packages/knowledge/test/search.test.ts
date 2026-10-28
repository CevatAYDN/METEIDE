import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	type CapabilityRef,
	err,
	type KnowledgeSearchOutput,
	ok,
	type Result,
	type StorageSqlAdapter,
	type ToolAdapter,
	type ToolContext,
	type ToolError,
} from "@mete/contracts";
import {
	createCapabilityRegistry,
	createEventBus,
	type ModuleContext,
} from "@mete/kernel";
import { createStorageModule } from "@mete/storage";
import { afterAll, describe, expect, it } from "vitest";
import { createKnowledgeSearchModule } from "../src/search-module.js";

// knowledge.search@1 over real storage in a temp folder (docs/11, Hybrid search; ADR-149). The fake
// fs.glob@1 lists under the workspace and leaves out what `hidden` names, as .meteignore does.

const roots: string[] = [];
afterAll(async () => {
	await Promise.all(roots.map((r) => rm(r, { recursive: true, force: true })));
});

const CTX: ToolContext = { runId: "r1", cwd: "elsewhere" } as ToolContext;

const fakeFs = (root: string, hidden: Set<string>) => ({
	glob: {
		run: async ({ path }: { readonly path: string }) => {
			try {
				const all = await readdir(join(root, path), { recursive: true });
				const paths = all
					.map((p) => `${path}/${p.replaceAll("\\", "/")}`)
					.filter((p) => p.endsWith(".md") && !hidden.has(p));
				return ok({ paths });
			} catch {
				return err({ code: "not_found", message: `${path} is missing` });
			}
		},
	},
	read: {
		run: async ({ path }: { readonly path: string }, ctx: ToolContext) =>
			ok({
				content: await readFile(join(ctx.cwd ?? root, path), "utf8"),
				totalLines: 1,
				lineEnding: "lf",
			}),
	},
});

const setup = async () => {
	const root = await mkdtemp(join(tmpdir(), "mete-search-"));
	roots.push(root);
	const registry = createCapabilityRegistry(() => []);
	const log = () => {};
	const base: ModuleContext = {
		capabilities: registry,
		events: createEventBus((e) => {
			throw e;
		}),
		config: { get: () => ok(undefined as never) },
		logger: { error: log, warn: log, info: log, debug: log },
		disposables: { add: () => {}, dispose: () => {} },
	};
	const storage = createStorageModule({
		workspaceDir: join(root, "ws"),
		globalDir: join(root, "global"),
	});
	await storage.activate(base);
	const sql = registry.resolve<StorageSqlAdapter>("storage.sql@1");
	if (!sql.ok) throw new Error("storage.sql@1 missing");
	const ws = join(root, "ws");
	const hidden = new Set<string>();
	const fs = fakeFs(ws, hidden);
	for (const [ref, impl] of [
		["fs.glob@1", fs.glob],
		["fs.read@1", fs.read],
	] as const)
		registry.provide(ref as CapabilityRef, {
			id: "fake",
			trust: "core",
			features: [],
			impl,
		});
	const mod = createKnowledgeSearchModule();
	const activated = await mod.activate({
		...base,
		storage: sql.value[0].impl.scopeFor("knowledge-search"),
	});
	const tool =
		registry.resolve<ToolAdapter<unknown, KnowledgeSearchOutput>>(
			"knowledge.search@1",
		);
	if (!tool.ok) throw new Error("knowledge.search@1 missing");
	const search = (
		input: unknown,
	): Promise<Result<KnowledgeSearchOutput, ToolError>> =>
		tool.value[0].impl.run(input, CTX);
	const note = async (path: string, text: string) => {
		const file = join(ws, ".mete/knowledge", path);
		await mkdir(dirname(file), { recursive: true });
		await writeFile(file, text, "utf8");
	};
	const remove = (path: string) => rm(join(ws, ".mete/knowledge", path));
	const close = () => storage.deactivate();
	return { activated, base, search, note, remove, hidden, close };
};

const paths = (r: Result<KnowledgeSearchOutput, ToolError>) =>
	r.ok ? r.value.results.map((h) => h.path) : r.error.code;

describe("knowledge.search@1", () => {
	it("finds a section by a word without its accents, with its note's facts and its rank", async () => {
		const s = await setup();
		expect(s.activated.ok).toBe(true);
		await s.note(
			"lessons/kahve.md",
			"---\ntype: lesson\ntitle: Kahve fiyatları\n---\n\nIntro.\n\n## Fiyat\nŞubat fiyatı 85 TL oldu.\n",
		);
		const r = await s.search({ query: "subat" });
		expect(r).toEqual(
			ok({
				results: [
					{
						path: "lessons/kahve.md",
						scope: "workspace",
						type: "lesson",
						title: "Kahve fiyatları",
						heading: "Fiyat",
						snippet: "Şubat fiyatı 85 TL oldu.",
						sources: { keyword: 1 },
					},
				],
			}),
		);
		expect(paths(await s.search({ query: "lesson" }))).toEqual([]);
		await s.close();
	});

	it("never finds a private note, the history, a note of no type or an ignored file", async () => {
		const s = await setup();
		await s.note("lessons/a.md", "---\nprivate: true\n---\nsecret word");
		await s.note(
			".history/lessons/b.md/1.md",
			"---\ntype: lesson\n---\nsecret word",
		);
		await s.note("readme.md", "secret word");
		await s.note("decisions/c.md", "secret word");
		s.hidden.add(".mete/knowledge/decisions/c.md");
		expect(paths(await s.search({ query: "secret" }))).toEqual([]);
		s.hidden.clear();
		expect(paths(await s.search({ query: "secret" }))).toEqual([
			"decisions/c.md",
		]);
		await s.close();
	});

	it("indexes an edited note again and forgets a deleted one", async () => {
		const s = await setup();
		await s.note("journal/2026-10-28.md", "old words");
		expect(paths(await s.search({ query: "old" }))).toHaveLength(1);
		await s.note("journal/2026-10-28.md", "new words");
		expect(paths(await s.search({ query: "old" }))).toEqual([]);
		expect(paths(await s.search({ query: "new" }))).toHaveLength(1);
		await s.remove("journal/2026-10-28.md");
		expect(paths(await s.search({ query: "new" }))).toEqual([]);
		await s.close();
	});

	it("filters by type and path, keeps k results and orders equal scores by path", async () => {
		const s = await setup();
		for (const p of ["lessons/b.md", "lessons/a.md", "entities/c.md"])
			await s.note(p, "same text");
		expect(paths(await s.search({ query: "same" }))).toEqual([
			"entities/c.md",
			"lessons/a.md",
			"lessons/b.md",
		]);
		expect(paths(await s.search({ query: "same", type: "lesson" }))).toEqual([
			"lessons/a.md",
			"lessons/b.md",
		]);
		expect(paths(await s.search({ query: "same", path: "entities/" }))).toEqual(
			["entities/c.md"],
		);
		const two = await s.search({ query: "same", k: 2 });
		expect(two.ok && two.value.results.map((h) => h.sources.keyword)).toEqual([
			1, 2,
		]);
		await s.close();
	});

	it("finds a note that holds any word of the query, the one with more of them first (ADR-151)", async () => {
		const s = await setup();
		await s.note("lessons/one.md", "mockup colors");
		await s.note("lessons/both.md", "mockup prices in TL");
		await s.note("lessons/none.md", "nothing here");
		expect(paths(await s.search({ query: "mockup prices" }))).toEqual([
			"lessons/both.md",
			"lessons/one.md",
		]);
		await s.close();
	});

	it("answers no vault with nothing and refuses the personal vault and a query of no word", async () => {
		const s = await setup();
		expect(await s.search({ query: "x" })).toEqual(ok({ results: [] }));
		expect(paths(await s.search({ query: "x", scope: "personal" }))).toBe(
			"not_found",
		);
		expect(paths(await s.search({ query: "..." }))).toBe("bad_input");
		expect(paths(await s.search({ query: "x", k: 0 }))).toBe("bad_input");
		await s.close();
	});

	it("does not start without storage", async () => {
		const s = await setup();
		const r = await createKnowledgeSearchModule().activate(s.base);
		expect(r.ok ? "" : r.error.code).toBe("activation_failed");
		await s.close();
	});
});
