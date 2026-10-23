import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
	AUDIT_MIGRATIONS,
	createAuditWriter,
	readAuditLog,
} from "../../src/infrastructure/audit-log.js";

// The audit log's reader (ADR-053) over a real SQLite database with security's own schema.

const RUN = "7f3c2a1e-4b5d-4c6e-8f9a-0b1c2d3e4f5a";
const OTHER = "0b6f0a43-3f0e-4a3e-9a58-1b2c3d4e5f60";

const filled = () => {
	const db = new Database(":memory:");
	for (const m of AUDIT_MIGRATIONS) db.exec(m.sql);
	const write = createAuditWriter(db);
	const row = (runId: string, action: string, verdict: string) =>
		write({
			ts: "2026-10-23T10:00:00.000Z",
			runId,
			agentId: null,
			action,
			capability: action === "shell.exec" ? "shell.exec@1" : "fs.write@1",
			adapterId: "tools",
			argsSha256: "a".repeat(64),
			verdict,
			rule: "autonomy:2",
			tainted: false,
		});
	row(RUN, "fs.write", "allow");
	row(RUN, "shell.exec", "ask");
	row(OTHER, "shell.exec", "deny");
	row(RUN, "fs.write", "allow");
	return db;
};

describe("the audit log reader", () => {
	it("returns every row newest first, up to the limit", () => {
		const db = filled();
		expect(readAuditLog(db, { limit: 10 }).map((r) => r.seq)).toEqual([
			4, 3, 2, 1,
		]);
		expect(readAuditLog(db, { limit: 2 }).map((r) => r.seq)).toEqual([4, 3]);
	});

	it("narrows by run, verdict and action, together", () => {
		const db = filled();
		expect(
			readAuditLog(db, { runId: RUN, limit: 10 }).map((r) => r.seq),
		).toEqual([4, 2, 1]);
		expect(
			readAuditLog(db, { verdict: "deny", limit: 10 }).map((r) => r.runId),
		).toEqual([OTHER]);
		expect(
			readAuditLog(db, { runId: RUN, action: "shell.exec", limit: 10 }).map(
				(r) => r.verdict,
			),
		).toEqual(["ask"]);
		expect(
			readAuditLog(db, { runId: RUN, verdict: "deny", limit: 10 }),
		).toEqual([]);
	});
});
