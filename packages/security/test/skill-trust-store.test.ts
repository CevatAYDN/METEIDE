import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import {
	createSkillTrustStore,
	SKILL_TRUST_MIGRATIONS,
} from "../src/infrastructure/skill-trust-store.js";

const workspaceKey = "a".repeat(64);
const source = {
	sourceId: "b".repeat(64),
	scope: "workspace" as const,
	path: "review/SKILL.md",
};
const input = {
	workspaceKey,
	source,
	sha256: "c".repeat(64),
	enabled: true,
	expectedRevision: 0,
	at: "2026-11-08T12:00:00.000Z",
};
const databases: Database.Database[] = [];
const roots: string[] = [];
afterEach(() => {
	for (const db of databases.splice(0)) if (db.open) db.close();
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});
const setup = (file = ":memory:") => {
	const db = new Database(file);
	databases.push(db);
	for (const migration of SKILL_TRUST_MIGRATIONS) db.exec(migration.sql);
	return { db, store: createSkillTrustStore(db) };
};
const record = (revision: number, enabled = true) => ({
	source,
	sha256: input.sha256,
	enabled,
	revision,
});
const failed = { ok: false, error: { code: "storage_failed" } };

describe("the private global skill trust store", () => {
	it("rejects invalid native inputs without persisting rows", () => {
		const { db, store } = setup();
		const bad = { ok: false, error: { code: "bad_input" } };
		expect(store.update({ ...input, sha256: "invalid" })).toEqual(bad);
		expect(store.update({ ...input, expectedRevision: -1 })).toEqual(bad);
		expect(store.update({ ...input, at: "invalid" })).toEqual(bad);
		expect(store.read(workspaceKey, "invalid")).toEqual(bad);
		expect(store.list("C:\\private-root")).toEqual(bad);
		expect(
			db.prepare("SELECT COUNT(*) FROM skill_trust_grants").pluck().get(),
		).toBe(0);
		expect(
			db.prepare("SELECT COUNT(*) FROM skill_trust_decisions").pluck().get(),
		).toBe(0);
	});

	it("creates and replaces the current digest with monotonic revisions", () => {
		const { db, store } = setup();
		expect(store.read(workspaceKey, source.sourceId)).toEqual({
			ok: true,
			value: undefined,
		});
		expect(store.update(input)).toEqual({ ok: true, value: record(1) });
		const sha256 = "d".repeat(64);
		expect(store.update({ ...input, sha256, expectedRevision: 1 })).toEqual({
			ok: true,
			value: { ...record(2), sha256 },
		});
		expect(store.list(workspaceKey)).toEqual({
			ok: true,
			value: [{ ...record(2), sha256 }],
		});
		expect(
			db
				.prepare("SELECT record, at FROM skill_trust_decisions ORDER BY seq")
				.all(),
		).toEqual([
			{ record: JSON.stringify(record(1)), at: input.at },
			{ record: JSON.stringify({ ...record(2), sha256 }), at: input.at },
		]);
	});

	it("refuses stale creation and update without changing grants or audit", () => {
		const { db, store } = setup();
		const stale = { ok: false, error: { code: "stale" } };
		expect(store.update({ ...input, expectedRevision: 1 })).toEqual(stale);
		expect(store.update(input).ok).toBe(true);
		expect(store.update(input)).toEqual(stale);
		expect(store.read(workspaceKey, source.sourceId)).toEqual({
			ok: true,
			value: record(1),
		});
		expect(
			db.prepare("SELECT COUNT(*) FROM skill_trust_decisions").pluck().get(),
		).toBe(1);
	});

	it("retains a disabled tombstone and digest, then re-enables at a new revision", () => {
		const { db, store } = setup();
		store.update(input);
		expect(
			store.update({ ...input, enabled: false, expectedRevision: 1 }),
		).toEqual({
			ok: true,
			value: record(2, false),
		});
		expect(store.list(workspaceKey)).toEqual({
			ok: true,
			value: [record(2, false)],
		});
		expect(store.update({ ...input, expectedRevision: 2 })).toEqual({
			ok: true,
			value: record(3),
		});
		expect(
			db.prepare("SELECT COUNT(*) FROM skill_trust_grants").pluck().get(),
		).toBe(1);
		expect(() => db.exec("DELETE FROM skill_trust_decisions")).toThrow();
		expect(() =>
			db.exec("UPDATE skill_trust_decisions SET at = 'changed'"),
		).toThrow();
	});

	it("isolates workspace grants including global sources", () => {
		const { store } = setup();
		const globalSource = { ...source, scope: "global" as const };
		expect(store.update({ ...input, source: globalSource }).ok).toBe(true);
		const other = "e".repeat(64);
		expect(store.list(other)).toEqual({ ok: true, value: [] });
		expect(store.read(other, source.sourceId)).toEqual({
			ok: true,
			value: undefined,
		});
		expect(
			store.update({ ...input, workspaceKey: other, source: globalSource }).ok,
		).toBe(true);
		expect(
			store.update({
				...input,
				source: globalSource,
				enabled: false,
				expectedRevision: 1,
			}).ok,
		).toBe(true);
		expect(store.read(other, source.sourceId)).toEqual({
			ok: true,
			value: { ...record(1), source: globalSource },
		});
	});

	it("persists the tombstone and decision history across reopen", () => {
		const root = mkdtempSync(join(tmpdir(), "mete-skill-trust-"));
		roots.push(root);
		const file = join(root, "global.db");
		const { db, store } = setup(file);
		store.update(input);
		store.update({ ...input, enabled: false, expectedRevision: 1 });
		db.close();
		const reopened = new Database(file);
		databases.push(reopened);
		expect(createSkillTrustStore(reopened).list(workspaceKey)).toEqual({
			ok: true,
			value: [record(2, false)],
		});
		expect(
			reopened
				.prepare("SELECT COUNT(*) FROM skill_trust_decisions")
				.pluck()
				.get(),
		).toBe(2);
	});

	it.each([
		"{",
		JSON.stringify({ ...record(1), revision: 0 }),
		JSON.stringify({ ...record(1), sha256: "invalid" }),
		JSON.stringify({
			...record(1),
			source: { ...source, sourceId: "f".repeat(64) },
		}),
		JSON.stringify({ ...record(1), body: "never persist raw instructions" }),
	])("fails closed on corrupt persisted records: %s", (json) => {
		const { db, store } = setup();
		store.update(input);
		db.prepare("UPDATE skill_trust_grants SET record = ?").run(json);
		expect(store.read(workspaceKey, source.sourceId)).toEqual(failed);
		expect(store.list(workspaceKey)).toEqual(failed);
		expect(store.update({ ...input, expectedRevision: 1 })).toEqual(failed);
	});

	it.each([false, true])(
		"rolls back grant and revision when audit insertion fails (existing=%s)",
		(existing) => {
			const { db, store } = setup();
			if (existing) store.update(input);
			db.exec(`CREATE TRIGGER reject_skill_decision BEFORE INSERT ON skill_trust_decisions
			BEGIN SELECT RAISE(ABORT, 'forced audit failure'); END`);
			expect(
				store.update({ ...input, expectedRevision: existing ? 1 : 0 }),
			).toEqual(failed);
			expect(store.read(workspaceKey, source.sourceId)).toEqual({
				ok: true,
				value: existing ? record(1) : undefined,
			});
			expect(
				db.prepare("SELECT COUNT(*) FROM skill_trust_decisions").pluck().get(),
			).toBe(existing ? 1 : 0);
		},
	);
});
