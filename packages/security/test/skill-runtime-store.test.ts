import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ok, type SkillReceipt, SkillReceiptSchema } from "@mete/contracts";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import {
	createSkillRuntimeStore,
	SKILL_RUNTIME_MIGRATIONS,
} from "../src/infrastructure/skill-runtime-store.js";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const workspaceKey = "a".repeat(64);
const receipt = (n: number): SkillReceipt => ({
	receiptId: id(100 + n),
	operationId: id(200 + n),
	owner: { runId: id(1), contextId: id(2), taskId: id(3), attemptId: id(4) },
	version: {
		sourceId: n.toString(16).padStart(64, "0"),
		sha256: "b".repeat(64),
		revision: 1,
	},
	origin: "explicit",
	loadedAt: "2026-11-08T00:00:00Z",
	payloadSha256: "c".repeat(64),
});
const failed = (code: string) => ({ ok: false, error: { code } });
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
	for (const migration of SKILL_RUNTIME_MIGRATIONS) db.exec(migration.sql);
	return { db, store: createSkillRuntimeStore(db) };
};
const input = (value = receipt(1)) => ({ workspaceKey, receipt: value });

describe("global runtime receipt membership", () => {
	it("returns complete empty and multi-context inventories above 128 across reopen", () => {
		const root = mkdtempSync(join(tmpdir(), "mete-skill-runtime-"));
		roots.push(root);
		const file = join(root, "global.db");
		const { db, store } = setup(file);
		expect(store.inventory(workspaceKey, id(1))).toEqual(
			ok({ runId: id(1), receipts: [] }),
		);
		const receipts = Array.from({ length: 132 }, (_, i) => ({
			...receipt(i + 1),
			owner: {
				...receipt(i + 1).owner,
				contextId: i < 4 ? id(2) : id(1000 + i),
			},
		}));
		for (const value of receipts)
			expect(store.issue(input(value))).toEqual(ok(value));
		const inventory = ok({ runId: id(1), receipts });
		expect(store.inventory(workspaceKey, id(1))).toEqual(inventory);
		expect(
			db
				.prepare(
					"SELECT workspace_key, record FROM skill_runtime_receipts ORDER BY receipt_id",
				)
				.all(),
		).toEqual(
			receipts.map((value) => ({
				workspace_key: workspaceKey,
				record: JSON.stringify(SkillReceiptSchema.parse(value)),
			})),
		);
		db.close();
		const reopened = new Database(file);
		databases.push(reopened);
		expect(
			createSkillRuntimeStore(reopened).inventory(workspaceKey, id(1)),
		).toEqual(inventory);
	});

	it("refuses foreign workspace collisions, rebound context owners and capacity overflow", () => {
		const { store } = setup();
		for (let n = 1; n <= 4; n++)
			expect(store.issue(input(receipt(n)))).toEqual(ok(receipt(n)));
		const before = store.inventory(workspaceKey, id(1));
		expect(store.inventory("d".repeat(64), id(1))).toEqual(
			failed("integrity_failed"),
		);
		expect(
			store.issue({ ...input(receipt(5)), workspaceKey: "d".repeat(64) }),
		).toEqual(failed("integrity_failed"));
		for (const field of ["runId", "taskId", "attemptId"] as const)
			expect(
				store.issue(
					input({
						...receipt(5),
						owner: { ...receipt(5).owner, [field]: id(99) },
					}),
				),
			).toEqual(failed("integrity_failed"));
		expect(store.issue(input(receipt(5)))).toEqual(failed("budget_exceeded"));
		expect(store.inventory(workspaceKey, id(1))).toEqual(before);
	});

	it("keeps healthy workspaces and runs isolated during global integrity validation", () => {
		const { store } = setup();
		const otherWorkspace = "d".repeat(64);
		const otherReceipt = {
			...receipt(2),
			owner: { ...receipt(2).owner, runId: id(90), contextId: id(91) },
		};
		expect(store.issue(input())).toEqual(ok(receipt(1)));
		expect(
			store.issue({
				workspaceKey: otherWorkspace,
				receipt: otherReceipt,
			}),
		).toEqual(ok(otherReceipt));
		expect(store.issue(input(receipt(3)))).toEqual(ok(receipt(3)));
		expect(store.inventory(workspaceKey, id(1))).toEqual(
			ok({
				runId: id(1),
				receipts: [receipt(1), receipt(3)],
			}),
		);
		expect(store.inventory(otherWorkspace, id(90))).toEqual(
			ok({
				runId: id(90),
				receipts: [otherReceipt],
			}),
		);
		for (const key of [workspaceKey, otherWorkspace]) {
			expect(store.inventory(key, id(99))).toEqual(
				ok({
					runId: id(99),
					receipts: [],
				}),
			);
		}
	});

	it("refuses every global duplicate atomically, including exact replay", () => {
		const { store } = setup();
		const first = receipt(1),
			second = receipt(2);
		expect(store.issue(input(first))).toEqual(ok(first));
		for (const value of [
			first,
			{ ...second, receiptId: first.receiptId },
			{ ...second, operationId: first.operationId },
			{ ...second, version: first.version },
			{
				...second,
				owner: { ...second.owner, contextId: id(99) },
				operationId: first.operationId,
			},
		]) {
			expect(store.issue(input(value))).toEqual(failed("stale"));
			expect(store.inventory(workspaceKey, id(1))).toEqual(
				ok({ runId: id(1), receipts: [first] }),
			);
		}
	});

	it("rejects extra bodies/raw roots and enforces append-only rows", () => {
		const { db, store } = setup();
		const body = {
			...input(),
			receipt: { ...receipt(1), text: "private body" },
		};
		expect(store.issue(body)).toEqual(failed("bad_input"));
		expect(
			store.issue({ ...input(), workspaceKey: "C:\\private-root" }),
		).toEqual(failed("bad_input"));
		expect(store.inventory(workspaceKey, "invalid")).toEqual(
			failed("bad_input"),
		);
		expect(store.inventory("invalid", id(1))).toEqual(failed("bad_input"));
		expect(store.inventory(workspaceKey, id(1))).toEqual(
			ok({ runId: id(1), receipts: [] }),
		);
		expect(store.issue(input())).toEqual(ok(receipt(1)));
		expect(() =>
			db.exec("UPDATE skill_runtime_receipts SET record = '{}'"),
		).toThrow();
		expect(() => db.exec("DELETE FROM skill_runtime_receipts")).toThrow();
		expect(store.inventory(workspaceKey, id(1))).toEqual(
			ok({ runId: id(1), receipts: [receipt(1)] }),
		);
	});

	it.each([
		["record", "{"],
		["record", JSON.stringify({ ...receipt(1), text: "private body" })],
		[
			"record",
			JSON.stringify({
				...receipt(1),
				owner: { ...receipt(1).owner, runId: id(99) },
			}),
		],
		[
			"record",
			JSON.stringify({
				...receipt(1),
				version: { ...receipt(1).version, revision: 0 },
			}),
		],
		["receipt_id", id(99)],
		["operation_id", id(99)],
		["context_id", id(99)],
		["source_id", "f".repeat(64)],
		["workspace_key", "invalid"],
		["run_id", id(99)],
	])("refuses corrupt %s columns or receipt JSON", (column, value) => {
		const { db, store } = setup();
		expect(store.issue(input())).toEqual(ok(receipt(1)));
		db.exec("DROP TRIGGER skill_runtime_receipts_no_update");
		db.prepare(`UPDATE skill_runtime_receipts SET ${column} = ?`).run(value);
		const before = db.prepare("SELECT * FROM skill_runtime_receipts").all();
		for (const runId of [id(1), id(99)]) {
			expect(store.inventory(workspaceKey, runId)).toEqual(
				failed("integrity_failed"),
			);
		}
		expect(store.issue(input(receipt(2)))).toEqual(failed("integrity_failed"));
		expect(db.prepare("SELECT * FROM skill_runtime_receipts").all()).toEqual(
			before,
		);
	});

	it.each([
		"{",
		"{}",
		JSON.stringify({ ...receipt(1), payloadSha256: "invalid" }),
		JSON.stringify({ ...receipt(1), payloadSha256: "d".repeat(64) }),
	])(
		"refuses hidden membership with relocated indexes and corrupt record %s",
		(record) => {
			const { db, store } = setup();
			expect(store.issue(input())).toEqual(ok(receipt(1)));
			db.exec("DROP TRIGGER skill_runtime_receipts_no_update");
			db.prepare(`UPDATE skill_runtime_receipts
			SET run_id = ?, context_id = ?, record = ?`).run(id(99), id(98), record);
			const before = db.prepare("SELECT * FROM skill_runtime_receipts").all();
			for (const runId of [id(1), id(99)]) {
				expect(store.inventory(workspaceKey, runId)).toEqual(
					failed("integrity_failed"),
				);
			}
			expect(store.issue(input(receipt(2)))).toEqual(
				failed("integrity_failed"),
			);
			expect(db.prepare("SELECT * FROM skill_runtime_receipts").all()).toEqual(
				before,
			);
		},
	);

	it.each([
		{
			mode: "owner",
			key: workspaceKey,
			receipts: [
				{
					...receipt(2),
					owner: { ...receipt(2).owner, taskId: id(99) },
				},
			],
		},
		{
			mode: "run",
			key: workspaceKey,
			receipts: [
				{
					...receipt(2),
					owner: { ...receipt(2).owner, runId: id(99) },
				},
			],
		},
		{ mode: "workspace", key: "d".repeat(64), receipts: [receipt(2)] },
		{ mode: "count", key: workspaceKey, receipts: [2, 3, 4, 5].map(receipt) },
	])(
		"refuses corrupt context $mode membership without hiding receipts",
		({ key, receipts }) => {
			const { db, store } = setup();
			expect(store.issue(input())).toEqual(ok(receipt(1)));
			for (const value of receipts) {
				db.prepare(`INSERT INTO skill_runtime_receipts
					(workspace_key, receipt_id, operation_id, run_id, context_id, source_id, record)
					VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
					key,
					value.receiptId,
					value.operationId,
					value.owner.runId,
					value.owner.contextId,
					value.version.sourceId,
					JSON.stringify(value),
				);
			}
			expect(store.inventory(workspaceKey, id(1))).toEqual(
				failed("integrity_failed"),
			);
			expect(store.issue(input(receipt(6)))).toEqual(
				failed("integrity_failed"),
			);
		},
	);

	it("keeps inventory unchanged when insertion fails and exposes DB read failures", () => {
		const { db, store } = setup();
		expect(store.issue(input())).toEqual(ok(receipt(1)));
		const before = store.inventory(workspaceKey, id(1));
		db.exec(`CREATE TRIGGER reject_runtime_receipt BEFORE INSERT ON skill_runtime_receipts
			BEGIN SELECT RAISE(ABORT, 'forced failure'); END`);
		expect(store.issue(input(receipt(2)))).toEqual(failed("storage_failed"));
		expect(store.inventory(workspaceKey, id(1))).toEqual(before);
		db.close();
		expect(store.inventory(workspaceKey, id(1))).toEqual(
			failed("storage_failed"),
		);
		expect(store.issue(input(receipt(2)))).toEqual(failed("storage_failed"));
	});
});
