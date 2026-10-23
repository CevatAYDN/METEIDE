import type { Readable, Writable } from "node:stream";
import {
	DAEMON_ERROR_CODE,
	DAEMON_METHODS,
	type DaemonErrorData,
	DaemonStatusParamsSchema,
	type EngineError,
	EVENT_TYPES,
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

// `mete daemon`: protocol version 2 of ARCHITECTURE.md (Daemon protocol, ADR-045 and ADR-046).

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

// A refused call keeps the EngineError code in data, so the desktop can tell not_found from a bug.
// The engine is looked up per request: while it is not active the answer is not_ready with the
// reasons (ADR-046), so the daemon stays up for the desktop to explain.
const serveStatus = (conn: MessageConnection, app: App) =>
	conn.onRequest(DAEMON_METHODS.status, (params: unknown) => {
		const p = DaemonStatusParamsSchema.safeParse(params ?? {});
		if (!p.success)
			throw new ResponseError(ErrorCodes.InvalidParams, p.error.message);
		const engine = engineOf(app);
		if (!engine.ok) {
			const data: DaemonErrorData = {
				code: "not_ready",
				reasons: notReadyLines(app, engine.error),
			};
			throw new ResponseError(
				DAEMON_ERROR_CODE,
				"core-engine is not active",
				data,
			);
		}
		const r = engine.value.status(p.data.runId);
		if (!r.ok) {
			throw new ResponseError(
				DAEMON_ERROR_CODE,
				r.error.message,
				refusedData(r.error),
			);
		}
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
