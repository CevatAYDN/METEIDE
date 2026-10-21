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
});
