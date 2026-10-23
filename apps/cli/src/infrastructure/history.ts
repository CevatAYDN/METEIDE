import type { StorageSqlAdapter } from "@mete/contracts";
import type { CapabilityRegistry } from "@mete/kernel";
import { type AuditFilter, readAuditLog } from "@mete/security";
import { readRunEvents } from "@mete/storage";

// A run's persisted events (docs/07, events table), read through the workspace database
// storage.sql@1 opened. The CLI is the composition root, so it may read storage's table.
// shortcut: an events-read capability for other consumers comes with the desktop.

/** The run's events in order and the rows that no longer parse, or why none could be read. */
export const runHistory = (registry: CapabilityRegistry, runId: string) => {
	const sql = registry.resolve<StorageSqlAdapter>("storage.sql@1");
	if (!sql.ok) return undefined;
	return readRunEvents(sql.value[0].impl.scopeFor("cli").workspace, runId);
};

/** The workspace audit log rows that match (ADR-053), or undefined while storage is not active. */
export const auditHistory = (
	registry: CapabilityRegistry,
	filter: AuditFilter,
) => {
	const sql = registry.resolve<StorageSqlAdapter>("storage.sql@1");
	if (!sql.ok) return undefined;
	return readAuditLog(sql.value[0].impl.scopeFor("cli").workspace, filter);
};
