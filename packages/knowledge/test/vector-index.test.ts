import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ok, type StorageSqlAdapter } from "@mete/contracts";
import {
	createCapabilityRegistry,
	createEventBus,
	type ModuleContext,
} from "@mete/kernel";
import { createStorageModule } from "@mete/storage";
import { afterAll, describe, expect, it } from "vitest";
import {
	cacheKey,
	VECTOR_MIGRATIONS,
	vectorIndex,
} from "../src/infrastructure/vector-index.js";

// The vector source's storage (docs/11, Hybrid search; ADR-152) over the storage module, which loads
// sqlite-vec into the workspace database (S4a).

const roots: string[] = [];
afterAll(async () => {
	await Promise.all(roots.map((r) => rm(r, { recursive: true, force: true })));
});

const setup = async () => {
	const root = await mkdtemp(join(tmpdir(), "mete-vectors-"));
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
	const scoped = sql.value[0].impl.scopeFor("knowledge-search");
	expect(scoped.migrate("workspace", VECTOR_MIGRATIONS).ok).toBe(true);
	return { db: scoped.workspace, close: () => storage.deactivate() };
};

const A = "nvidia/embed-a";
const B = "custom:x/embed-b";

describe("the vector index", () => {
	it("keys a section by its text and the model, so a model change embeds it again", () => {
		expect(cacheKey("same text", A)).toBe(cacheKey("same text", A));
		expect(cacheKey("same text", A)).not.toBe(cacheKey("same text", B));
		expect(cacheKey("same text", A)).toMatch(/^[0-9a-f]{64}$/);
	});

	it("sizes a model's table by its first answer and finds the nearest keys first", async () => {
		const s = await setup();
		const v = vectorIndex(s.db);
		expect(v.available).toBe(true);
		expect(v.latest()).toBeUndefined();
		expect(v.nearest(A, [1, 0, 0], 2)).toEqual([]);
		expect(
			v.put(A, [
				{ key: "k1", vector: [1, 0, 0] },
				{ key: "k2", vector: [0, 1, 0] },
				{ key: "k3", vector: [0.9, 0.2, 0] },
			]).ok,
		).toBe(true);
		expect(v.latest()).toBe(A);
		expect(v.nearest(A, [1, 0, 0], 2)).toEqual(["k1", "k3"]);
		expect(v.nearest(A, [0, 0, 1], 3)).toEqual([]);
		expect([...v.stored(A, ["k1", "k9", "k2"])].sort()).toEqual(["k1", "k2"]);
		const wrong = v.put(A, [{ key: "k4", vector: [1, 0] }]);
		expect(wrong.ok).toBe(false);
		expect(v.nearest(A, [1, 0], 2)).toEqual([]);
		await s.close();
	});

	it("gives a second model a table of its own, of its own size, and takes it as the latest", async () => {
		const s = await setup();
		const v = vectorIndex(s.db);
		v.put(A, [{ key: "k1", vector: [1, 0, 0] }]);
		expect(v.put(B, [{ key: "k1", vector: [0, 0, 1, 0] }]).ok).toBe(true);
		expect(v.latest()).toBe(B);
		expect(v.nearest(B, [0, 0, 1, 0], 5)).toEqual(["k1"]);
		expect(v.nearest(A, [1, 0, 0], 5)).toEqual(["k1"]);
		expect(v.stored(B, ["k1"]).size).toBe(1);
		await s.close();
	});

	it("is unavailable, and stores and finds nothing, where sqlite-vec is not loaded", async () => {
		const s = await setup();
		const fake = {
			prepare: () => {
				throw new Error("no such function: vec_version");
			},
		};
		const v = vectorIndex(fake as unknown as typeof s.db);
		expect(v.available).toBe(false);
		expect(v.put(A, [{ key: "k1", vector: [1] }]).ok).toBe(false);
		expect(v.nearest(A, [1], 1)).toEqual([]);
		expect(v.stored(A, ["k1"]).size).toBe(0);
		await s.close();
	});
});
