import type { StorageSqlAdapter } from "@mete/contracts";
import { readRunEvents } from "@mete/storage";
import type { App } from "./app.js";

// A run's persisted events (docs/07, events table), read through the workspace database
// storage.sql@1 opened. The CLI is the composition root, so it may read storage's table.
// shortcut: an events-read capability for other consumers comes with the desktop.

/** The run's events in order and the rows that no longer parse, or why none could be read. */
export const runHistory = (app: App, runId: string) => {
	const sql = app.registry.resolve<StorageSqlAdapter>("storage.sql@1");
	if (!sql.ok) return undefined;
	return readRunEvents(sql.value[0].impl.scopeFor("cli").workspace, runId);
};
