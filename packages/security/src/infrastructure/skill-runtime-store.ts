import {
	err,
	IdSchema,
	type Migration,
	ok,
	type Result,
	type SkillReceipt,
	SkillReceiptSchema,
	type SkillRuntimeError,
	type SkillRuntimeInventory,
	SkillRuntimeInventorySchema,
	SkillSourceIdSchema,
} from "@mete/contracts";
import type BetterSqlite3 from "better-sqlite3";
import { z } from "zod";

const IssueSchema = z.strictObject({
	workspaceKey: SkillSourceIdSchema,
	receipt: SkillReceiptSchema,
});
const InventoryInputSchema = IssueSchema.pick({ workspaceKey: true }).extend({
	runId: IdSchema,
});
const RowSchema = z.strictObject({
	workspace_key: SkillSourceIdSchema,
	receipt_id: IdSchema,
	operation_id: IdSchema,
	run_id: IdSchema,
	context_id: IdSchema,
	source_id: SkillSourceIdSchema,
	record: z.string(),
});

/** Append-only content-free receipts in security's global storage scope. */
export const SKILL_RUNTIME_MIGRATIONS: Migration[] = [
	{
		id: "001-skill-runtime",
		sql: `CREATE TABLE skill_runtime_receipts (
		workspace_key TEXT NOT NULL, receipt_id TEXT NOT NULL PRIMARY KEY,
		operation_id TEXT NOT NULL UNIQUE, run_id TEXT NOT NULL,
		context_id TEXT NOT NULL, source_id TEXT NOT NULL, record TEXT NOT NULL,
		UNIQUE (context_id, source_id)
	);
	CREATE INDEX skill_runtime_receipts_run ON skill_runtime_receipts (run_id);
	CREATE TRIGGER skill_runtime_receipts_no_update BEFORE UPDATE ON skill_runtime_receipts
		BEGIN SELECT RAISE(ABORT, 'append-only receipts'); END;
	CREATE TRIGGER skill_runtime_receipts_no_delete BEFORE DELETE ON skill_runtime_receipts
		BEGIN SELECT RAISE(ABORT, 'append-only receipts'); END;`,
	},
];

const integrityFailed = () =>
	err<SkillRuntimeError>({ code: "integrity_failed" });
const attempt = <T>(
	operation: () => Result<T, SkillRuntimeError>,
): Result<T, SkillRuntimeError> => {
	try {
		return operation();
	} catch {
		return err({ code: "storage_failed" });
	}
};
const parseReceipt = (
	data: z.infer<typeof RowSchema>,
): Result<SkillReceipt, SkillRuntimeError> => {
	let json: unknown;
	try {
		json = JSON.parse(data.record);
	} catch {
		return integrityFailed();
	}
	const receipt = SkillReceiptSchema.safeParse(json);
	if (!receipt.success) return integrityFailed();
	const value = receipt.data;
	if (
		data.receipt_id !== value.receiptId ||
		data.operation_id !== value.operationId ||
		data.run_id !== value.owner.runId ||
		data.context_id !== value.owner.contextId ||
		data.source_id !== value.version.sourceId
	)
		return integrityFailed();
	return ok(value);
};
const parseRows = (
	rows: unknown[],
	workspaceKey?: string,
): Result<SkillReceipt[], SkillRuntimeError> => {
	const receipts: SkillReceipt[] = [];
	for (const row of rows) {
		const parsed = RowSchema.safeParse(row);
		if (
			!parsed.success ||
			(workspaceKey !== undefined && parsed.data.workspace_key !== workspaceKey)
		)
			return integrityFailed();
		const receipt = parseReceipt(parsed.data);
		if (!receipt.ok) return receipt;
		receipts.push(receipt.value);
	}
	return ok(receipts);
};
const readInventory = (
	db: BetterSqlite3.Database,
	workspaceKey: string,
	runId: string,
): Result<SkillRuntimeInventory, SkillRuntimeError> => {
	// ponytail: O(global receipt count) per read/issue to detect hidden membership.
	// Optimize only with equivalent index-independent integrity evidence.
	const integrity = parseRows(
		db.prepare("SELECT * FROM skill_runtime_receipts").all(),
	);
	if (!integrity.ok) return integrity;
	// Read the run first: a foreign workspace collision must never look empty.
	const rows = db
		.prepare(
			"SELECT * FROM skill_runtime_receipts WHERE run_id = ? ORDER BY receipt_id",
		)
		.all(runId);
	const parsed = parseRows(rows, workspaceKey);
	if (!parsed.ok) return parsed;
	const membership = parseRows(
		db
			.prepare(`SELECT * FROM skill_runtime_receipts
		WHERE context_id IN (SELECT context_id FROM skill_runtime_receipts WHERE run_id = ?)
		ORDER BY receipt_id`)
			.all(runId),
		workspaceKey,
	);
	if (!membership.ok) return membership;
	const inventory = SkillRuntimeInventorySchema.safeParse({
		runId,
		receipts: membership.value,
	});
	return inventory.success ? ok(inventory.data) : integrityFailed();
};
const validateRelated = (
	related: SkillReceipt[],
	receipt: SkillReceipt,
): Result<void, SkillRuntimeError> => {
	for (const prior of related) {
		if (
			prior.owner.contextId === receipt.owner.contextId &&
			(prior.owner.runId !== receipt.owner.runId ||
				prior.owner.taskId !== receipt.owner.taskId ||
				prior.owner.attemptId !== receipt.owner.attemptId)
		)
			return integrityFailed();
	}
	if (
		related.some(
			(prior) =>
				prior.receiptId === receipt.receiptId ||
				prior.operationId === receipt.operationId ||
				(prior.owner.contextId === receipt.owner.contextId &&
					prior.version.sourceId === receipt.version.sourceId),
		)
	)
		return err({ code: "stale" });
	return ok(undefined);
};
const issue = (
	db: BetterSqlite3.Database,
	input: z.infer<typeof IssueSchema>,
): Result<SkillReceipt, SkillRuntimeError> => {
	const { workspaceKey, receipt } = input;
	const current = readInventory(db, workspaceKey, receipt.owner.runId);
	if (!current.ok) return current;
	const rows = db
		.prepare(`SELECT * FROM skill_runtime_receipts
		WHERE context_id = ? OR receipt_id = ? OR operation_id = ?`)
		.all(receipt.owner.contextId, receipt.receiptId, receipt.operationId);
	const related = parseRows(rows, workspaceKey);
	if (!related.ok) return related;
	const valid = validateRelated(related.value, receipt);
	if (!valid.ok) return valid;
	const next = SkillRuntimeInventorySchema.safeParse({
		runId: receipt.owner.runId,
		receipts: [...current.value.receipts, receipt],
	});
	if (!next.success) return err({ code: "budget_exceeded" });
	db.prepare(`INSERT INTO skill_runtime_receipts
		(workspace_key, receipt_id, operation_id, run_id, context_id, source_id, record)
		VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
		workspaceKey,
		receipt.receiptId,
		receipt.operationId,
		receipt.owner.runId,
		receipt.owner.contextId,
		receipt.version.sourceId,
		JSON.stringify(receipt),
	);
	return ok(receipt);
};

/** Private transactional receipt store; native callers own admission and DB lifetime. */
export const createSkillRuntimeStore = (db: BetterSqlite3.Database) => ({
	inventory: (
		workspaceKey: string,
		runId: string,
	): Result<SkillRuntimeInventory, SkillRuntimeError> =>
		attempt(() => {
			const parsed = InventoryInputSchema.safeParse({ workspaceKey, runId });
			if (!parsed.success) return err({ code: "bad_input" });
			return db
				.transaction(() => readInventory(db, workspaceKey, runId))
				.deferred();
		}),
	issue: (input: {
		workspaceKey: string;
		receipt: SkillReceipt;
	}): Result<SkillReceipt, SkillRuntimeError> =>
		attempt(() => {
			const parsed = IssueSchema.safeParse(input);
			if (!parsed.success) return err({ code: "bad_input" });
			return db.transaction(() => issue(db, parsed.data)).immediate();
		}),
});
