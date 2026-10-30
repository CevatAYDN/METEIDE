import {
	DAEMON_METHODS,
	DaemonAuditParamsSchema,
	DaemonKnowledgeSearchParamsSchema,
	type KnowledgeSearchInput,
	type KnowledgeSearchOutput,
	type ToolAdapter,
} from "@mete/contracts";
import {
	ErrorCodes,
	type MessageConnection,
	ResponseError,
} from "vscode-jsonrpc/node";
import { SEARCH_K, SEARCH_TIMEOUT_MS } from "../defaults.js";
import type { App } from "../infrastructure/app.js";
import { auditEntries } from "./audit.js";
import { parsed, refused } from "./daemon-errors.js";

// The daemon's reads of storage-backed modules (ARCHITECTURE.md, Daemon protocol): the audit log
// and the workspace vault's search. Neither needs core-engine, so both answer while it is not
// active too, as mete/quota does.

// The workspace audit log (ADR-053).
export const serveAudit = (conn: MessageConnection, app: App) =>
	conn.onRequest(DAEMON_METHODS.audit, (params: unknown) => {
		const p = parsed(DaemonAuditParamsSchema.safeParse(params ?? {}));
		const entries = auditEntries(app, p);
		if (!entries)
			throw new ResponseError(
				ErrorCodes.InternalError,
				"storage is not active",
			);
		return { entries };
	});

type Search = ToolAdapter<KnowledgeSearchInput, KnowledgeSearchOutput>;

// The Memory screen's search (ADR-159): knowledge.search@1 over the workspace vault.
export const serveKnowledgeSearch = (conn: MessageConnection, app: App) =>
	conn.onRequest(DAEMON_METHODS.knowledgeSearch, async (params: unknown) => {
		const p = parsed(DaemonKnowledgeSearchParamsSchema.safeParse(params ?? {}));
		const search = app.registry.resolve<Search>("knowledge.search@1");
		if (!search.ok)
			throw refused({
				code: "not_supported",
				message: "knowledge.search@1 is not active",
			});
		const r = await search.value[0].impl.run(
			{ ...p, scope: "workspace", k: SEARCH_K },
			{ signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) },
		);
		if (!r.ok)
			throw new ResponseError(ErrorCodes.InternalError, r.error.message);
		return r.value;
	});
