import type { StorageSqlAdapter } from "@mete/contracts";
import { afterEach, describe, expect, it } from "vitest";

// Contract kit for storage.sql@1 (docs/06 Kernel API, docs/15 Contract tests).

/** Opens a fresh adapter for one test; `close` releases it afterwards. */
export type StorageSqlHarness = () => Promise<{
	readonly adapter: StorageSqlAdapter;
	readonly close: () => Promise<void>;
}>;

const TABLES = "SELECT name FROM sqlite_master WHERE type = 'table'";

/** Every storage.sql@1 adapter MUST pass these tests. */
export const storageSqlContract = (name: string, open: StorageSqlHarness) =>
	describe(`storage.sql@1 contract: ${name}`, () => {
		let close: (() => Promise<void>) | undefined;
		afterEach(async () => {
			await close?.();
			close = undefined;
		});
		const fresh = async () => {
			const h = await open();
			close = h.close;
			return h.adapter;
		};

		it("migrates once, then reads back what it wrote", async () => {
			const s = (await fresh()).scopeFor("kit");
			const steps = [
				{
					id: "001",
					sql: "CREATE TABLE kit_items (id INTEGER PRIMARY KEY, name TEXT)",
				},
			];
			expect(s.migrate("workspace", steps).ok).toBe(true);
			expect(s.migrate("workspace", steps).ok).toBe(true);
			s.workspace.prepare("INSERT INTO kit_items (name) VALUES (?)").run("a");
			const names = s.workspace
				.prepare("SELECT name FROM kit_items")
				.pluck()
				.all();
			expect(names).toEqual(["a"]);
		});

		it("keeps the workspace and global databases apart", async () => {
			const s = (await fresh()).scopeFor("kit");
			s.migrate("global", [{ id: "001", sql: "CREATE TABLE kit_global (x)" }]);
			expect(s.global.prepare(TABLES).pluck().all()).toContain("kit_global");
			expect(s.workspace.prepare(TABLES).pluck().all()).not.toContain(
				"kit_global",
			);
		});

		it("keeps each module's ledger apart", async () => {
			const adapter = await fresh();
			const a = adapter.scopeFor("kit-a");
			const b = adapter.scopeFor("kit-b");
			expect(
				a.migrate("workspace", [{ id: "001", sql: "CREATE TABLE kit_a (x)" }])
					.ok,
			).toBe(true);
			expect(
				b.migrate("workspace", [{ id: "001", sql: "CREATE TABLE kit_b (x)" }])
					.ok,
			).toBe(true);
			expect(a.workspace.prepare(TABLES).pluck().all()).toEqual(
				expect.arrayContaining(["kit_a", "kit_b"]),
			);
		});

		it("reports a failing migration as migration_failed", async () => {
			const s = (await fresh()).scopeFor("kit");
			const r = s.migrate("workspace", [{ id: "001", sql: "CREATE TABLE (" }]);
			expect(r.ok ? undefined : r.error).toMatchObject({
				code: "migration_failed",
				moduleId: "kit",
				migrationId: "001",
			});
		});
	});
