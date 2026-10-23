import { type AuditEntry, AuditEntrySchema } from "@mete/contracts";
import { AUDIT_LIMIT } from "../defaults.js";
import type { App } from "../infrastructure/app.js";
import { auditHistory } from "../infrastructure/history.js";
import type { Io } from "./commands.js";

// The workspace audit log (SECURITY.md, Audit log; ADR-053), for `mete audit` and the daemon's
// mete/audit. Each row is checked against the protocol schema on the way out.

/** Which rows to show; every filter is optional. */
export type AuditQuery = {
	readonly runId?: string | undefined;
	readonly verdict?: string | undefined;
	readonly action?: string | undefined;
	readonly limit?: number | undefined;
};

/** The matching rows, newest first, or undefined while storage is not active. */
export const auditEntries = (
	app: App,
	q: AuditQuery,
): AuditEntry[] | undefined =>
	auditHistory(app.registry, { ...q, limit: q.limit ?? AUDIT_LIMIT })?.map(
		(r) => AuditEntrySchema.parse(r),
	);

const line = (e: AuditEntry) =>
	[
		e.ts,
		e.runId ?? "-",
		`${e.action} ${e.capability}`,
		e.verdict,
		e.rule,
		e.tainted ? "tainted" : "",
	]
		.filter(Boolean)
		.join("  ");

/** `mete audit [<run id>] [--json]`: the audit log, newest first. */
export const auditCommand = (
	app: App,
	io: Io,
	runId: string | undefined,
	json: boolean,
) => {
	const entries = auditEntries(app, runId ? { runId } : {});
	if (!entries) {
		io.err("storage.sql@1 is not active, so the audit log cannot be read");
		return 1;
	}
	if (json) io.out(JSON.stringify(entries, null, 2));
	else if (entries.length === 0) io.err("the audit log has no rows");
	else for (const e of entries) io.out(line(e));
	return 0;
};
