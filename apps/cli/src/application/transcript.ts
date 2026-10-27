import { DAEMON_METHODS, DaemonRunIdParamsSchema } from "@mete/contracts";
import type { MessageConnection } from "vscode-jsonrpc/node";
import type { App } from "../infrastructure/app.js";
import { parsed, readyEngine, refused } from "./daemon-errors.js";

// The steps of a run's saved conversation for the Team panel (ADR-125); the engine masks them when
// it reads them, and a refusal keeps the EngineError code, as for mete/status.
export const serveTranscript = (conn: MessageConnection, app: App) =>
	conn.onRequest(DAEMON_METHODS.runTranscript, async (params: unknown) => {
		const p = parsed(DaemonRunIdParamsSchema.safeParse(params ?? {}));
		const engine = readyEngine(app);
		if (!engine.transcript)
			throw refused({
				code: "not_supported",
				message: "run transcripts are not supported",
			});
		const r = await engine.transcript(p.runId);
		if (!r.ok) throw refused(r.error);
		return r.value;
	});
