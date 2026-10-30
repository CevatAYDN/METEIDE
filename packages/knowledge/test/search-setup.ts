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
	type LlmEmbedAdapter,
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
import { afterAll } from "vitest";
import { createKnowledgeSearchModule } from "../src/search-module.js";

// knowledge.search@1 over real storage in a temp folder (docs/11, Hybrid search; ADR-149, ADR-152).
// The fake fs.glob@1 lists under the workspace and leaves out what `hidden` names, as .meteignore
// does; `embed`, when given, is llm.embed@1.

const roots: string[] = [];
afterAll(async () => {
	await Promise.all(roots.map((r) => rm(r, { recursive: true, force: true })));
});

export const CTX: ToolContext = {
	runId: "r1",
	cwd: "elsewhere",
	signal: new AbortController().signal,
};

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

export type SetupOptions = {
	readonly embed?: LlmEmbedAdapter;
	readonly now?: () => number;
};

export const setup = async (opts: SetupOptions = {}) => {
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
		...(opts.embed ? [["llm.embed@1", opts.embed] as const] : []),
	] as const)
		registry.provide(ref as CapabilityRef, {
			id: "fake",
			trust: "core",
			features: [],
			impl,
		});
	const mod = createKnowledgeSearchModule(opts.now ? { now: opts.now } : {});
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
		ctx: ToolContext = CTX,
	): Promise<Result<KnowledgeSearchOutput, ToolError>> =>
		tool.value[0].impl.run(input, ctx);
	const note = async (path: string, text: string) => {
		const file = join(ws, ".mete/knowledge", path);
		await mkdir(dirname(file), { recursive: true });
		await writeFile(file, text, "utf8");
	};
	const remove = (path: string) => rm(join(ws, ".mete/knowledge", path));
	const close = async () => {
		await mod.deactivate();
		await storage.deactivate();
	};
	return { activated, base, search, note, remove, hidden, close };
};

export const paths = (r: Result<KnowledgeSearchOutput, ToolError>) =>
	r.ok ? r.value.results.map((h) => h.path) : r.error.code;
