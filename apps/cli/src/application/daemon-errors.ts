import {
	DAEMON_ERROR_CODE,
	type DaemonErrorData,
	type EngineError,
} from "@mete/contracts";
import { ErrorCodes, ResponseError } from "vscode-jsonrpc/node";
import { type App, engineOf, notReadyLines } from "../infrastructure/app.js";

// How `mete daemon` refuses a request (ARCHITECTURE.md, Daemon protocol).

// The error data of a refused engine call (ADR-047: choose_template keeps the router's suggestions).
const refusedData = (e: EngineError): DaemonErrorData =>
	e.code === "choose_template"
		? { code: e.code, suggestions: [...e.suggestions] }
		: { code: e.code };

/** A refused engine call, which keeps the EngineError code in data so the desktop can tell not_found from a bug. */
export const refused = (e: EngineError) =>
	new ResponseError(DAEMON_ERROR_CODE, e.message, refusedData(e));

/**
 * The engine, looked up per request: while it is not active the answer is not_ready with the
 * reasons (ADR-046), so the daemon stays up for the desktop to explain.
 */
export const readyEngine = (app: App) => {
	const engine = engineOf(app);
	if (engine.ok) return engine.value;
	const data: DaemonErrorData = {
		code: "not_ready",
		reasons: notReadyLines(app, engine.error),
	};
	throw new ResponseError(DAEMON_ERROR_CODE, "core-engine is not active", data);
};

/** The params a schema parsed; they are checked before the engine, so a bad request says so even while METE is not ready. */
export const parsed = <T>(
	r:
		| { success: true; data: T }
		| { success: false; error: { message: string } },
) => {
	if (!r.success)
		throw new ResponseError(ErrorCodes.InvalidParams, r.error.message);
	return r.data;
};
