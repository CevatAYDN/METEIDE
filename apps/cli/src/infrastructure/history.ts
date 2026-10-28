import type { EventsReadAdapter, StorageSqlAdapter } from "@mete/contracts";
import type { CapabilityRegistry } from "@mete/kernel";
import { type AuditFilter, readAuditLog } from "@mete/security";

// A run's persisted events (docs/07, events table), read through events.read@1 (ADR-144).

/** The run's events in order and the rows that no longer parse, or undefined while storage is not active. */
export const runHistory = (registry: CapabilityRegistry, runId: string) => {
	const events = registry.resolve<EventsReadAdapter>("events.read@1");
	return events.ok ? events.value[0].impl.read(runId) : undefined;
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
