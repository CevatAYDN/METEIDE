import type { Readable, Writable } from "node:stream";
import {
	DAEMON_ERROR_CODE,
	DAEMON_METHODS,
	DaemonAuditParamsSchema,
	DaemonChainParamsSchema,
	DaemonCheckpointRestoreParamsSchema,
	type DaemonErrorData,
	DaemonEstimateParamsSchema,
	DaemonProviderModelsParamsSchema,
	DaemonProviderTestParamsSchema,
	DaemonRunApproveParamsSchema,
	DaemonRunIdParamsSchema,
	DaemonStatusParamsSchema,
	DaemonTemplateReadParamsSchema,
	type EngineError,
	EVENT_TYPES,
	RunStartSchema,
	type SecretsMaskAdapter,
} from "@mete/contracts";
import { listTemplates, readTemplate } from "@mete/core";
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
import { runHistory } from "../infrastructure/history.js";
import { auditEntries } from "./audit.js";
import type { Io } from "./commands.js";
import { estimateFor } from "./estimate.js";
import {
	LISTING_TIMEOUT_MS,
	providerStates,
	quotaUnits,
	trackExhausted,
} from "./provider-states.js";
import { customAdapter, endpointModels, probeModels } from "./provider-test.js";
import { restoreCheckpoint } from "./rollback.js";
import { settingsOf } from "./settings.js";

// `mete daemon`: protocol version 17 of ARCHITECTURE.md (Daemon protocol, ADR-045 to ADR-087).

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

// The human's decision on a run paused for approval, and resume (ADR-048); both answer null.
const serveApproveAndResume = (conn: MessageConnection, app: App) => {
	conn.onRequest(DAEMON_METHODS.runApprove, async (params: unknown) => {
		const p = parsed(DaemonRunApproveParamsSchema.safeParse(params ?? {}));
		const r = await readyEngine(app).approve(p.runId, p.input);
		if (!r.ok) throw refused(r.error);
		return null;
	});
	conn.onRequest(DAEMON_METHODS.runResume, async (params: unknown) => {
		const p = parsed(DaemonRunIdParamsSchema.safeParse(params ?? {}));
		const r = await readyEngine(app).resume(p.runId);
		if (!r.ok) throw refused(r.error);
		return null;
	});
};

const UNENDED = new Set(["queued", "running", "paused"]);

// The kill switch (ADR-065): every run that has not ended is cancelled, which aborts what it has in
// flight; one the engine refuses is skipped with a line on stderr, so the others still stop.
const serveStopAll = (conn: MessageConnection, app: App, io: Io) =>
	conn.onRequest(DAEMON_METHODS.stopAll, async () => {
		const engine = readyEngine(app);
		const listed = engine.status();
		if (!listed.ok) throw refused(listed.error);
		const cancelled: string[] = [];
		for (const run of listed.value.filter((r) => UNENDED.has(r.status))) {
			const r = await engine.cancel(run.id);
			if (r.ok) cancelled.push(run.id);
			else io.err(`could not cancel ${run.id}: ${r.error.message}`);
		}
		return { cancelled };
	});

// A run's persisted events for the team panel (ADR-051): the engine answers not_found for a run it
// does not know, as for mete/status; rows that no longer parse are counted, never dropped silently.
const serveEvents = (conn: MessageConnection, app: App) =>
	conn.onRequest(DAEMON_METHODS.events, (params: unknown) => {
		const p = parsed(DaemonRunIdParamsSchema.safeParse(params ?? {}));
		const r = readyEngine(app).status(p.runId);
		if (!r.ok) throw refused(r.error);
		const history = runHistory(app.registry, p.runId);
		if (!history)
			throw new ResponseError(
				ErrorCodes.InternalError,
				"storage is not active",
			);
		return { events: history.events, unreadable: history.broken.length };
	});

// A run's checkpoint by the id of its checkpoint.created event (ADR-079); a refusal keeps its code.
const serveCheckpointRestore = (conn: MessageConnection, app: App) =>
	conn.onRequest(DAEMON_METHODS.checkpointRestore, async (params: unknown) => {
		const p = parsed(
			DaemonCheckpointRestoreParamsSchema.safeParse(params ?? {}),
		);
		readyEngine(app);
		const pick = (e: { id: string }) => e.id === p.checkpointId;
		const r = await restoreCheckpoint(app, p.runId, pick);
		if (r.ok) return r.value;
		if (r.error.code === "no_storage")
			throw new ResponseError(ErrorCodes.InternalError, r.error.message);
		const data: DaemonErrorData = { code: r.error.code };
		throw new ResponseError(DAEMON_ERROR_CODE, r.error.message, data);
	});

// The configuration the daemon loaded (ADR-081); it needs no engine, so it answers while METE is not ready.
const serveSettings = (conn: MessageConnection, app: App) =>
	conn.onRequest(DAEMON_METHODS.settings, async () => {
		const settings = await settingsOf(app);
		if (!settings)
			throw new ResponseError(
				ErrorCodes.InternalError,
				"secrets.mask@1 is not active",
			);
		return settings;
	});

// A custom endpoint's adapter and the masker for its messages (ADR-087); no engine is needed. An
// endpoint that is not loaded, or has no key, is not_found.
const endpointOf = (app: App, providerId: string) => {
	const masker = app.registry.resolve<SecretsMaskAdapter>("secrets.mask@1");
	if (!masker.ok)
		throw new ResponseError(
			ErrorCodes.InternalError,
			"secrets.mask@1 is not active",
		);
	const adapter = customAdapter(app, providerId);
	if (adapter) return { adapter, mask: masker.value[0].impl };
	const data: DaemonErrorData = { code: "not_found" };
	throw new ResponseError(DAEMON_ERROR_CODE, `no ${providerId}`, data);
};

// The Settings screen's custom endpoint card: its models, and Test (ADR-087).
const serveProviders = (conn: MessageConnection, app: App) => {
	conn.onRequest(DAEMON_METHODS.providerModels, async (params: unknown) => {
		const p = parsed(DaemonProviderModelsParamsSchema.safeParse(params));
		const { adapter, mask } = endpointOf(app, p.providerId);
		return endpointModels(adapter, mask);
	});
	conn.onRequest(DAEMON_METHODS.providerTest, async (params: unknown) => {
		const p = parsed(DaemonProviderTestParamsSchema.safeParse(params));
		const { adapter, mask } = endpointOf(app, p.providerId);
		return probeModels(adapter, p.models, mask);
	});
};

// The workspace audit log (ADR-053); it needs storage only, so it answers while core-engine is not
// active too, as mete/quota does.
const serveAudit = (conn: MessageConnection, app: App) =>
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

// The templates the composer offers (ADR-058): files only, so no engine is needed.
const serveTemplates = (conn: MessageConnection, app: App) =>
	conn.onRequest(DAEMON_METHODS.templates, async () => {
		const { templates } = await listTemplates(app.templates);
		return {
			templates: templates.map(({ metadata: m }) => ({
				id: m.id,
				name: m.name,
				...(m.description ? { description: m.description } : {}),
			})),
		};
	});

// A template file's text for the team editor (ADR-075): files only, so no engine is needed; a miss keeps
// its not_found or bad_input code, and a file that cannot be read is an internal error.
const serveTemplateRead = (conn: MessageConnection, app: App) =>
	conn.onRequest(DAEMON_METHODS.templateRead, async (params: unknown) => {
		const { id } = parsed(DaemonTemplateReadParamsSchema.safeParse(params));
		const read = await readTemplate(app.templates, id);
		if (read.ok)
			return { id, source: read.value.source, yaml: read.value.text };
		const e = read.error;
		if (e.code !== "not_found" && e.code !== "bad_input")
			throw new ResponseError(
				ErrorCodes.InternalError,
				`template ${id} cannot be read`,
			);
		const data: DaemonErrorData = { code: e.code };
		throw new ResponseError(DAEMON_ERROR_CODE, `no template ${id}`, data);
	});

// The models a tier's chain would try for a member's needs, for the team editor's pinned model
// (ADR-077): the gateway's listing only, so no engine is needed, and no pin, so every choice shows.
const serveChain = (conn: MessageConnection, app: App) =>
	conn.onRequest(DAEMON_METHODS.chain, async (params: unknown) => {
		const { tier, needs } = parsed(DaemonChainParamsSchema.safeParse(params));
		const signal = AbortSignal.timeout(LISTING_TIMEOUT_MS);
		return { models: await app.chain({ tier }, { needs }, signal) };
	});

// The composer's request estimate per provider (ADR-068): files and the gateway's listing only, so no
// engine is needed; a template that does not load is not_found.
const serveEstimate = (
	conn: MessageConnection,
	app: App,
	until: (id: string) => string | undefined,
) =>
	conn.onRequest(DAEMON_METHODS.estimate, async (params: unknown) => {
		const { templateId } = parsed(DaemonEstimateParamsSchema.safeParse(params));
		const estimate = await estimateFor(app, templateId, until);
		if (estimate) return estimate;
		const data: DaemonErrorData = { code: "not_found" };
		throw new ResponseError(
			DAEMON_ERROR_CODE,
			`no template ${templateId}`,
			data,
		);
	});

// Each provider's state for the quota dashboard (ADR-050); the daemon tracks spent quotas for its
// whole life, so a pause seen before the client asked still counts.
const serveQuota = (
	conn: MessageConnection,
	app: App,
	until: (id: string) => string | undefined,
) =>
	// The states come first: their model listing defines each provider's units in the pool.
	conn.onRequest(DAEMON_METHODS.quota, async () => ({
		providers: await providerStates(app, until),
		units: quotaUnits(app),
	}));

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
	serveApproveAndResume(conn, app);
	serveStopAll(conn, app, io);
	serveEvents(conn, app);
	serveAudit(conn, app);
	serveTemplates(conn, app);
	serveTemplateRead(conn, app);
	serveChain(conn, app);
	serveCheckpointRestore(conn, app);
	serveSettings(conn, app);
	serveProviders(conn, app);
	const spent = trackExhausted(app.events);
	serveQuota(conn, app, spent.until);
	serveEstimate(conn, app, spent.until);
	const unsubscribe = forwardEvents(app.events, conn, io);
	conn.listen();
	let stop = () => {};
	await new Promise<void>((resolve) => {
		conn.onClose(() => resolve());
		stop = io.onInterrupt(resolve);
	});
	stop();
	unsubscribe();
	spent.dispose();
	conn.dispose();
	return 0;
};
