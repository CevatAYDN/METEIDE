import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { BUSY_TIMEOUT_MS } from "../../src/defaults.js";
import {
	openDatabase,
	runMigrations,
} from "../../src/infrastructure/sqlite.js";

const roots: string[] = [];
afterAll(async () => {
	await Promise.all(roots.map((r) => rm(r, { recursive: true, force: true })));
});
const freshDb = async () => {
	const root = await mkdtemp(join(tmpdir(), "mete-sqlite-"));
	roots.push(root);
	return openDatabase(join(root, "nested", "mete.db"));
};
const tables = (db: Awaited<ReturnType<typeof freshDb>>) =>
	db
		.prepare(
			"SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
		)
		.pluck()
		.all();

describe("openDatabase", () => {
	it("creates the folder and uses WAL with the busy timeout", async () => {
		const db = await freshDb();
		expect(db.pragma("journal_mode", { simple: true })).toBe("wal");
		expect(db.pragma("busy_timeout", { simple: true })).toBe(BUSY_TIMEOUT_MS);
		db.close();
	});

	it("enforces foreign keys", async () => {
		const db = await freshDb();
		expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
		db.exec(
			"CREATE TABLE p (id INTEGER PRIMARY KEY); CREATE TABLE c (p INTEGER REFERENCES p(id))",
		);
		expect(() => db.prepare("INSERT INTO c VALUES (42)").run()).toThrow(
			/FOREIGN KEY/,
		);
		db.close();
	});
});

describe("runMigrations", () => {
	it("applies each migration once, in order", async () => {
		const db = await freshDb();
		const steps = [
			{ id: "001", sql: "CREATE TABLE quota_units (id TEXT PRIMARY KEY)" },
			{ id: "002", sql: "ALTER TABLE quota_units ADD COLUMN used INTEGER" },
		];
		expect(runMigrations(db, "quota", steps)).toEqual({
			ok: true,
			value: undefined,
		});
		expect(runMigrations(db, "quota", steps).ok).toBe(true);
		expect(tables(db)).toEqual(["quota_units", "storage_migrations"]);
		db.close();
	});

	it("keeps one ledger per module id", async () => {
		const db = await freshDb();
		runMigrations(db, "quota", [{ id: "001", sql: "CREATE TABLE a (x)" }]);
		runMigrations(db, "security", [{ id: "001", sql: "CREATE TABLE b (x)" }]);
		expect(tables(db)).toEqual(["a", "b", "storage_migrations"]);
		db.close();
	});

	it("rolls back a failing migration and reports it", async () => {
		const db = await freshDb();
		const r = runMigrations(db, "quota", [
			{ id: "001", sql: "CREATE TABLE a (x); CREATE TABLE broken (" },
		]);
		expect(r.ok ? undefined : r.error).toMatchObject({
			code: "migration_failed",
			moduleId: "quota",
			migrationId: "001",
		});
		expect(tables(db)).toEqual(["storage_migrations"]);
		db.close();
	});

	it("reads the ledger under the same write lock it writes it, and a failure leaves no ledger row", async () => {
		const db = await freshDb();
		const ids = () =>
			db
				.prepare("SELECT id FROM storage_migrations WHERE module_id = 'quota'")
				.pluck()
				.all();
		const r = runMigrations(db, "quota", [
			{ id: "001", sql: "CREATE TABLE a (x)" },
			{ id: "002", sql: "CREATE TABLE broken (" },
		]);
		expect(r.ok ? undefined : r.error.migrationId).toBe("002");
		expect(ids()).toEqual([]);
		expect(tables(db)).toEqual(["storage_migrations"]);
		expect(db.inTransaction).toBe(false);
		// A second run starts from the ledger as left: the first step is applied again, not skipped.
		expect(
			runMigrations(db, "quota", [{ id: "001", sql: "CREATE TABLE a (x)" }]),
		).toEqual({ ok: true, value: undefined });
		expect(ids()).toEqual(["001"]);
		db.close();
	});
});
