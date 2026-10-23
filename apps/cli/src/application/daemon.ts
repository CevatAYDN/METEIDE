import type { Readable, Writable } from "node:stream";
import {
	DAEMON_ERROR_CODE,
	DAEMON_METHODS,
	type DaemonErrorData,
	DaemonStatusParamsSchema,
	type EngineError,
	EVENT_TYPES,
	RunStartSchema,
} from "@mete/contracts";
import type { EventBus } from "@mete/kernel";
import {
	createMessageConnection,
	ErrorCodes,
	type MessageConnection,
	ResponseError,
	StreamMessageReader,
	StreamMessageWriter,
} from "vscode-jsonrpc/node";
import { type App, engineOf, notReadyLines } from "../infrastructure/app.js";
import type { Io } from "./commands.js";

// `mete daemon`: protocol version 3 of ARCHITECTURE.md (Daemon protocol, ADR-045 to ADR-047).

/** What the daemon reads requests from and writes answers and events to. */
export type DaemonStreams = {
	readonly input: Readable;
	readonly output: Writable;
};

// The error data of a refused engine call (ADR-047: choose_template keeps the router's suggestions).
const refusedData = (e: EngineError): DaemonErrorData =>
	e.code === "choose_template"
		? { code: e.code, suggestions: [...e.suggestions] }
		: { code: e.code };

const refused = (e: EngineError) =>
	new ResponseError(DAEMON_ERROR_CODE, e.message, refusedData(e));

// The engine is looked up per request: while it is not active the answer is not_ready with the
// reasons (ADR-046), so the daemon stays up for the desktop to explain.
const readyEngine = (app: App) => {
	const engine = engineOf(app);
	if (engine.ok) return engine.value;
	const data: DaemonErrorData = {
		code: "not_ready",
		reasons: notReadyLines(app, engine.error),
	};
	throw new ResponseError(DAEMON_ERROR_CODE, "core-engine is not active", data);
};

// Params are checked before the engine, so a bad request says so even while METE is not ready.
const parsed = <T>(
	r:
		| { success: true; data: T }
		| { success: false; error: { message: string } },
) => {
	if (!r.success)
		throw new ResponseError(ErrorCodes.InvalidParams, r.error.message);
	return r.data;
};

// A refused call keeps the EngineError code in data, so the desktop can tell not_found from a bug.
const serveStatus = (conn: MessageConnection, app: App) =>
	conn.onRequest(DAEMON_METHODS.status, (params: unknown) => {
		const p = parsed(DaemonStatusParamsSchema.safeParse(params ?? {}));
		const r = readyEngine(app).status(p.runId);
		if (!r.ok) throw refused(r.error);
		return r.value;
	});

// The run goes on in this process; its events reach the client as mete/event (ADR-047).
const serveRunStart = (conn: MessageConnection, app: App) =>
	conn.onRequest(DAEMON_METHODS.runStart, async (params: unknown) => {
		const req = parsed(RunStartSchema.safeParse(params ?? {}));
		const r = await readyEngine(app).start(req);
		if (!r.ok) throw refused(r.error);
		return r.value;
	});

// The bus has no catch-all pattern, so each event domain gets its own subscription; one event
// matches one domain, so the notifications keep the publish order.
const forwardEvents = (events: EventBus, conn: MessageConnection, io: Io) => {
	const domains = new Set(EVENT_TYPES.map((t) => t.slice(0, t.indexOf("."))));
	const subscriptions = [...domains].map((domain) =>
		events.subscribe(`${domain}.*`, (e) => {
			conn.sendNotification(DAEMON_METHODS.event, e).catch((error: unknown) => {
				const why = error instanceof Error ? error.message : String(error);
				io.err(`could not send ${e.type}: ${why}`);
			});
		}),
	);
	return () => {
		for (const s of subscriptions) s.dispose();
	};
};

/**
 * `mete daemon`: serves the workspace to one desktop client until it closes the input or Ctrl+C.
 * stdout carries only the protocol, so every line here goes to stderr.
 */
export const daemonCommand = async (
	app: App,
	io: Io,
	workspaceDir: string,
	streams: DaemonStreams,
) => {
	io.err(`serving METE to a desktop client for ${workspaceDir}`);
	const engine = engineOf(app);
	if (!engine.ok)
		for (const line of notReadyLines(app, engine.error)) io.err(line);
	const conn = createMessageConnection(
		new StreamMessageReader(streams.input),
		new StreamMessageWriter(streams.output),
	);
	serveStatus(conn, app);
	serveRunStart(conn, app);
	const unsubscribe = forwardEvents(app.events, conn, io);
	conn.listen();
	let stop = () => {};
	await new Promise<void>((resolve) => {
		conn.onClose(() => resolve());
		stop = io.onInterrupt(resolve);
	});
	stop();
	unsubscribe();
	conn.dispose();
	return 0;
};
