import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type LlmEmbedAdapter,
	type LlmEmbedRequest,
	ok,
	type StorageSqlAdapter,
} from "@mete/contracts";
import {
	createCapabilityRegistry,
	createEventBus,
	type ModuleContext,
} from "@mete/kernel";
import { createStorageModule } from "@mete/storage";
import { describe, expect, it } from "vitest";
import { ACCESS_MIGRATION } from "../src/infrastructure/access-log.js";
import {
	INDEX_MIGRATIONS,
	keywordIndex,
} from "../src/infrastructure/keyword-index.js";
import {
	cacheKey,
	VECTOR_MIGRATIONS,
	vectorIndex,
} from "../src/infrastructure/vector-index.js";
import { paths, setup } from "./search-setup.js";

const PATH = "lessons/private.md";
const CACHED = "secret tsc stored";
const PENDING = "secret palette pending";
const TEXT = `---\nprivate: true\ntags: [\n---\n${CACHED}\n\n## Pending\n${PENDING}`;
const MODEL = { providerId: "fake", modelId: "embed-1" };
const KEY = `${MODEL.providerId}/${MODEL.modelId}`;

const seedLegacy = async (root: string) => {
	const registry = createCapabilityRegistry(() => []);
	const log = () => {};
	const ctx: ModuleContext = {
		capabilities: registry,
		events: createEventBus((error) => {
			throw error;
		}),
		config: { get: () => ok(undefined as never) },
		logger: { error: log, warn: log, info: log, debug: log },
		disposables: { add: () => {}, dispose: () => {} },
	};
	const storage = createStorageModule({
		workspaceDir: join(root, "ws"),
		globalDir: join(root, "global"),
	});
	expect((await storage.activate(ctx)).ok).toBe(true);
	try {
		const sql = registry.resolve<StorageSqlAdapter>("storage.sql@1");
		if (!sql.ok) throw new Error("storage.sql@1 missing");
		const scoped = sql.value[0].impl.scopeFor("knowledge-search");
		// Only migrations shipped before frontmatter hardening belong to this database.
		const legacy = INDEX_MIGRATIONS.filter((m) =>
			["001-knowledge-index", "003-knowledge-aging"].includes(m.id),
		);
		expect(
			scoped.migrate("workspace", [
				...legacy,
				...VECTOR_MIGRATIONS,
				ACCESS_MIGRATION,
			]).ok,
		).toBe(true);
		const index = keywordIndex(scoped.workspace);
		const sha = createHash("sha256").update(TEXT).digest("hex");
		index.update(
			[
				{
					path: PATH,
					sha,
					facts: { title: "Private", type: "lesson", pinned: false },
					sections: [{ text: CACHED }, { heading: "Pending", text: PENDING }],
				},
			],
			[],
		);
		const vectors = vectorIndex(scoped.workspace);
		expect(
			vectors.put(KEY, [
				{
					key: cacheKey(CACHED, KEY),
					vector: [1, 0, 0.1],
				},
			]).ok,
		).toBe(true);
		expect(index.shas().get(PATH)).toBe(sha);
		expect(index.search({ match: '"secret"', k: 8 })).toHaveLength(2);
		expect(vectors.nearest(KEY, [1, 0, 0.1], 8)).toEqual(
			ok([cacheKey(CACHED, KEY)]),
		);
	} finally {
		await storage.deactivate();
	}
};

describe("knowledge.search@1 upgrade", () => {
	it("rechecks an unchanged malformed note with a matching legacy SHA before search or embedding", async () => {
		const root = await mkdtemp(join(tmpdir(), "mete-search-upgrade-"));
		const file = join(root, "ws", ".mete", "knowledge", PATH);
		try {
			await mkdir(join(file, ".."), { recursive: true });
			await writeFile(file, TEXT, "utf8");
			await seedLegacy(root);
			const calls: LlmEmbedRequest[] = [];
			const embed: LlmEmbedAdapter = {
				embed: async (req) => {
					calls.push(req);
					return ok({
						model: MODEL,
						vectors: req.input.map(() => [1, 0, 0.1]),
					});
				},
			};
			const reopened = await setup({ root, embed });
			try {
				expect(reopened.activated.ok).toBe(true);
				expect(paths(await reopened.search({ query: "secret" }))).toEqual([]);
				expect(paths(await reopened.search({ query: "compilation" }))).toEqual(
					[],
				);
				expect(calls.filter((c) => c.purpose === "query")).not.toEqual([]);
				expect(calls.filter((c) => c.purpose === "document")).toEqual([]);
				expect(await readFile(file, "utf8")).toBe(TEXT);
			} finally {
				await reopened.close();
			}
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
