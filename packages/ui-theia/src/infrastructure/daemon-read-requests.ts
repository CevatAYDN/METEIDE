import {
	DAEMON_METHODS,
	DaemonAuditResultSchema,
	DaemonChangesResultSchema,
	DaemonEventsResultSchema,
	DaemonKnowledgeSearchResultSchema,
	DaemonQuotaResultSchema,
	DaemonStatusResultSchema,
	TranscriptSchema,
} from "@mete/contracts";
import type { Send } from "./settings-requests.js";

/** Read-only requests through the host's existing ensure/send boundary. */
export const daemonReadRequests = (send: Send) => ({
	status: (dir: string, runId?: string) =>
		send(
			dir,
			DAEMON_METHODS.status,
			runId === undefined ? {} : { runId },
			(raw) => DaemonStatusResultSchema.safeParse(raw),
		),
	events: (dir: string, runId: string) =>
		send(dir, DAEMON_METHODS.events, { runId }, (raw) =>
			DaemonEventsResultSchema.safeParse(raw),
		),
	transcript: (dir: string, runId: string) =>
		send(dir, DAEMON_METHODS.runTranscript, { runId }, (raw) =>
			TranscriptSchema.safeParse(raw),
		),
	audit: (dir: string, filter: object) =>
		send(dir, DAEMON_METHODS.audit, filter, (raw) =>
			DaemonAuditResultSchema.safeParse(raw),
		),
	knowledgeSearch: (dir: string, query: string) =>
		send(dir, DAEMON_METHODS.knowledgeSearch, { query }, (raw) =>
			DaemonKnowledgeSearchResultSchema.safeParse(raw),
		),
	changes: (dir: string, path?: string) =>
		send(
			dir,
			DAEMON_METHODS.changes,
			path === undefined ? {} : { path },
			(raw) => DaemonChangesResultSchema.safeParse(raw),
		),
	quota: (dir: string) =>
		send(dir, DAEMON_METHODS.quota, {}, (raw) =>
			DaemonQuotaResultSchema.safeParse(raw),
		),
});
