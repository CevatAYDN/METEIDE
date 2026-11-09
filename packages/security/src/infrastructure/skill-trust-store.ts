import {
	err,
	type Migration,
	ok,
	type Result,
	type SkillError,
	SkillSourceDescriptorSchema,
	SkillSourceIdSchema,
} from "@mete/contracts";
import type BetterSqlite3 from "better-sqlite3";
import { z } from "zod";

const RecordSchema = z.strictObject({
	source: SkillSourceDescriptorSchema,
	sha256: SkillSourceIdSchema,
	enabled: z.boolean(),
	revision: z.number().int().positive().safe(),
});
const UpdateSchema = RecordSchema.omit({ revision: true }).extend({
	workspaceKey: SkillSourceIdSchema,
	expectedRevision: z.number().int().nonnegative().safe(),
	at: z.iso.datetime(),
});
const RowSchema = z.strictObject({
	source_id: SkillSourceIdSchema,
	record: z.string(),
});

/** Private current grant, including disabled tombstones (ADR-189). */
export type SkillTrustRecord = z.infer<typeof RecordSchema>;
/** Module-attested mutation; never exposed as an arbitrary-hash capability. */
export type SkillTrustUpdate = z.infer<typeof UpdateSchema>;

/** Apply through the owning module's global scoped storage, not workspace storage. */
export const SKILL_TRUST_MIGRATIONS: ReadonlyArray<Migration> = [
	{
		id: "001-skill-trust",
		sql: `CREATE TABLE skill_trust_grants (
		workspace_key TEXT NOT NULL, source_id TEXT NOT NULL, record TEXT NOT NULL,
		PRIMARY KEY (workspace_key, source_id)
	);
	CREATE TABLE skill_trust_decisions (
		seq INTEGER PRIMARY KEY, workspace_key TEXT NOT NULL,
		source_id TEXT NOT NULL, record TEXT NOT NULL, at TEXT NOT NULL
	);
	CREATE TRIGGER skill_trust_decisions_no_update BEFORE UPDATE ON skill_trust_decisions
		BEGIN SELECT RAISE(ABORT, 'append-only decisions'); END;
	CREATE TRIGGER skill_trust_decisions_no_delete BEFORE DELETE ON skill_trust_decisions
		BEGIN SELECT RAISE(ABORT, 'append-only decisions'); END;`,
	},
];

const storageFailed = () => err<SkillError>({ code: "storage_failed" });
const attempt = <T>(
	operation: () => Result<T, SkillError>,
): Result<T, SkillError> => {
	try {
		return operation();
	} catch {
		return storageFailed();
	}
};
const parseRow = (row: unknown): Result<SkillTrustRecord, SkillError> => {
	const parsed = RowSchema.safeParse(row);
	if (!parsed.success) return storageFailed();
	const record = RecordSchema.safeParse(JSON.parse(parsed.data.record));
	if (
		!record.success ||
		record.data.source.sourceId !== parsed.data.source_id
	) {
		return storageFailed();
	}
	return ok(record.data);
};
const selectRows = (
	db: BetterSqlite3.Database,
	workspaceKey: string,
	sourceId?: string,
): unknown[] => {
	const query =
		"SELECT source_id, record FROM skill_trust_grants WHERE workspace_key = ?";
	return sourceId === undefined
		? db.prepare(`${query} ORDER BY source_id`).all(workspaceKey)
		: db.prepare(`${query} AND source_id = ?`).all(workspaceKey, sourceId);
};
const readRows = (
	db: BetterSqlite3.Database,
	workspaceKey: string,
	sourceId?: string,
): Result<SkillTrustRecord[], SkillError> =>
	attempt(() => {
		if (
			!SkillSourceIdSchema.safeParse(workspaceKey).success ||
			(sourceId !== undefined &&
				!SkillSourceIdSchema.safeParse(sourceId).success)
		) {
			return err({ code: "bad_input" });
		}
		const rows = selectRows(db, workspaceKey, sourceId);
		const records: SkillTrustRecord[] = [];
		for (const row of rows) {
			const parsed = parseRow(row);
			if (!parsed.ok) return parsed;
			records.push(parsed.value);
		}
		return ok(records);
	});
const mutate = (
	db: BetterSqlite3.Database,
	input: SkillTrustUpdate,
): Result<SkillTrustRecord, SkillError> => {
	const current = readRows(db, input.workspaceKey, input.source.sourceId);
	if (!current.ok) return current;
	const prior = current.value[0];
	if (
		(prior?.revision ?? 0) !== input.expectedRevision ||
		(prior &&
			(prior.source.scope !== input.source.scope ||
				prior.source.path !== input.source.path))
	) {
		return err({ code: "stale" });
	}
	const parsed = RecordSchema.safeParse({
		source: input.source,
		sha256: !input.enabled && prior ? prior.sha256 : input.sha256,
		enabled: input.enabled,
		revision: input.expectedRevision + 1,
	});
	if (!parsed.success) return storageFailed();
	const record = JSON.stringify(parsed.data);
	const values = [input.workspaceKey, input.source.sourceId, record];
	db.prepare(`INSERT INTO skill_trust_grants (workspace_key, source_id, record)
		VALUES (?, ?, ?) ON CONFLICT (workspace_key, source_id)
		DO UPDATE SET record = excluded.record`).run(...values);
	db.prepare(`INSERT INTO skill_trust_decisions (workspace_key, source_id, record, at)
		VALUES (?, ?, ?, ?)`).run(...values, input.at);
	return ok(parsed.data);
};

/** Private synchronous store; the module owns admission, migrations and the DB lifetime. */
export const createSkillTrustStore = (db: BetterSqlite3.Database) => ({
	read: (
		workspaceKey: string,
		sourceId: string,
	): Result<SkillTrustRecord | undefined, SkillError> => {
		if (!SkillSourceIdSchema.safeParse(sourceId).success) {
			return err({ code: "bad_input" });
		}
		const records = readRows(db, workspaceKey, sourceId);
		return records.ok ? ok(records.value[0]) : records;
	},
	list: (workspaceKey: string) => readRows(db, workspaceKey),
	update: (input: SkillTrustUpdate): Result<SkillTrustRecord, SkillError> =>
		attempt(() => {
			const parsed = UpdateSchema.safeParse(input);
			if (!parsed.success) return err({ code: "bad_input" });
			return db.transaction(() => mutate(db, parsed.data)).immediate();
		}),
});
