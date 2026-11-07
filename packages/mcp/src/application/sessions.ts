import { pathToFileURL } from "node:url";
import {
	type CapabilityRef,
	err,
	type McpServer,
	ok,
	type Result,
	type RuntimeEnsureAdapter,
	type SecretStore,
	type SecretsMaskAdapter,
	type ToolContext,
	type ToolError,
} from "@mete/contracts";
import type { Logger } from "@mete/kernel";
import type {
	Client,
	ListChangedCallback,
	Progress,
	Tool,
} from "@modelcontextprotocol/client";
import { SIGN_IN_ATTEMPTS } from "../defaults.js";
import type { Opened, OpenTransport } from "../infrastructure/transport.js";
import type { Calls } from "./calls.js";
import { logProgress, progressThrottle } from "./progress-log.js";
import type { Sample } from "./sampling.js";
import { type Elicit, installSessionCallbacks } from "./session-callbacks.js";

export type { Elicit } from "./session-callbacks.js";

import {
	closeSessionTransport,
	connectAndCommit,
	drainSessionCredentials,
	type PreparedSessionCredentials,
	prepareSessionCredentials,
	sessionConnectionError,
	sessionCredentialContext,
	trackSessionClose,
} from "./session-credentials.js";
import { openPendingSession, openSessionTransport } from "./session-opening.js";
import { type Authorize, type SignInMemory, signIn } from "./sign-in.js";

// The SDK client is imported on the first connection, as transport.ts imports the transports, so a
// command that calls no server never loads the SDK (ADR-163, docs/15 cold start).
type ClientSdk = typeof import("@modelcontextprotocol/client");

let loading: Promise<ClientSdk> | undefined;

const clientSdk = () => (loading ??= import("@modelcontextprotocol/client"));

/** A connected server and the tools it listed when it connected. */
export type Session = {
	readonly client: Client;
	readonly tools: readonly Tool[];
};

export type SessionDeps = {
	readonly moduleId: string;
	readonly version: string;
	readonly servers: readonly McpServer[];
	/** The workspace root: where a stdio server starts and the one root every server is told (docs/10, Roots). */
	readonly workspaceDir: string;
	readonly open: OpenTransport;
	readonly fetch?: typeof fetch;
	readonly logger: Logger;
	readonly mask?: SecretsMaskAdapter;
	/** runtime.ensure@1; without it a stdio command runs as configured. */
	readonly ensure?: RuntimeEnsureAdapter;
	/** How the host asks the user; without it the client does not offer elicitation and a server's request fails. */
	readonly elicit?: Elicit;
	/** The tool call in flight per server; sampling reads the run it belongs to from it. */
	readonly calls: Calls;
	/** Answers sampling requests; without it the client does not offer sampling. */
	readonly sample?: Sample;
	/** The keychain tokens of OAuth servers live in; without it a server with `auth: oauth` cannot connect. */
	readonly secrets?: SecretStore;
	/** How the host sends the user to sign in; without it only saved tokens work. */
	readonly authorize?: Authorize;
	/** ADR-184: a dedicated desktop attempt's exact loopback address; absent for terminal paste-back. */
	readonly oauthRedirectUrl?: string;
	/** Publishes a progress step of a call made in a run (ADR-067); without it progress reaches the log only. */
	readonly progress?: (ctx: ToolContext, step: ToolProgress) => void;
	/** The clock the progress throttle reads; tests pass a fixed one. */
	readonly now?: () => number;
};

/** What `agent.tool.progress` carries: never the server's message, which is tool output. */
export type ToolProgress = {
	readonly capability: CapabilityRef;
	readonly progress: number;
	readonly total?: number;
};

type ConnectionDeps = SessionDeps & {
	readonly pending: Set<Promise<void>>;
	readonly onSecrets: (values: readonly string[]) => void;
	readonly redact: (text: string) => string;
};
const failed = () =>
	err<ToolError>({ code: "io", message: "MCP connection cancelled or failed" });

const onToolsChanged =
	(
		deps: SessionDeps,
		server: McpServer,
		state: { tools: readonly Tool[] },
	): ListChangedCallback<Tool> =>
	(_error, tools) => {
		const at = { moduleId: deps.moduleId, server: server.id };
		if (!tools)
			return deps.logger.warn(
				at,
				"MCP server tool list could not be refreshed",
			);
		state.tools = tools;
		deps.logger.info(
			{ ...at, tools: tools.length },
			"MCP server tool list changed",
		);
	};

// The client lists the workspace as its one root, follows the server's tool list and, when the host
// can ask the user, answers form requests (docs/10, MCP client).
const newClient = (
	deps: ConnectionDeps,
	server: McpServer,
	state: { tools: readonly Tool[] },
	{ Client }: ClientSdk,
) => {
	const { elicit, sample } = deps;
	const client = new Client(
		{ name: "mete", version: deps.version },
		{
			capabilities: {
				roots: {},
				// Form requests only: a URL request would open a browser, which METE does not do.
				...(elicit ? { elicitation: { form: {} } } : {}),
				...(sample ? { sampling: {} } : {}),
			},
			listChanged: {
				tools: { onChanged: onToolsChanged(deps, server, state) },
			},
		},
	);
	// shortcut: the workspace is the only root; upgrade with the vault roots in Phase 4 (docs/10, Roots).
	const root = {
		uri: pathToFileURL(deps.workspaceDir).href,
		name: "workspace",
	};
	client.setRequestHandler("roots/list", () => ({ roots: [root] }));
	installSessionCallbacks(client, server.id, deps);
	trackSessionClose(client, deps.pending);
	return client;
};

/** The server to connect to, how to stop waiting for it, what to do when its connection closes, and its sign-ins so far. */
type Target = {
	readonly server: McpServer;
	readonly signal: AbortSignal;
	readonly closed: (stderr: string) => void;
	readonly signIns: SignInMemory;
};

type Tried = {
	readonly result: Result<Session, ToolError>;
	readonly refused?: Opened;
};

// One try at a connection. A server that answers 401 while a sign-in flow is ready hands back its transport.
const attempt = async (
	deps: ConnectionDeps,
	{ server, signal, closed }: Target,
	prepared: PreparedSessionCredentials,
): Promise<Tried> => {
	const { flow } = prepared;
	const sdk = await clientSdk();
	let opened: Opened | undefined;
	let client: Client | undefined;
	try {
		if (signal.aborted) return { result: failed() };
		opened = await openSessionTransport(deps.open, deps.workspaceDir, prepared);
		if (signal.aborted) {
			await opened.transport.close();
			return { result: failed() };
		}
		const state: { tools: readonly Tool[] } = { tools: [] };
		client = newClient(deps, server, state, sdk);
		const verified = await connectAndCommit(client, opened, signal, flow);
		if (!verified.ok) {
			await client.close();
			return { result: verified };
		}
		state.tools = verified.value;
		client.onclose = () => closed("");
		return {
			result: ok({
				client,
				get tools() {
					return state.tools;
				},
			}),
		};
	} catch (e) {
		await closeSessionTransport(client, opened);
		const result = err(
			await sessionConnectionError(
				server.id,
				opened?.stderr() ?? "",
				deps.mask,
			),
		);
		return flow && opened && e instanceof sdk.UnauthorizedError
			? { result, refused: opened }
			: { result };
	}
};

type Round = {
	readonly result: Result<Session, ToolError>;
	/** The pasted address was refused, so another address may be asked for. */
	readonly again: boolean;
};

// One try with a sign-in flow of its own, so every address asked for has a fresh state and PKCE: a
// server that wants a sign-in gets one, then one more try with the tokens it earned.
const round = async (deps: ConnectionDeps, at: Target): Promise<Round> => {
	const prepared = await prepareSessionCredentials(deps, at.server, at.signal);
	if (!prepared.ok) return { result: prepared, again: false };
	const flow = prepared.value.flow;
	const tried = await attempt(deps, at, prepared.value);
	if (!tried.refused || !flow) return { result: tried.result, again: false };
	const refused = {
		server: at.server,
		flow,
		opened: tried.refused,
	};
	const done = await signIn(deps.authorize, refused, at.signal, at.signIns);
	if (done.kind === "ok")
		return {
			result: (await attempt(deps, at, prepared.value)).result,
			again: false,
		};
	return { result: err(done.error), again: done.kind === "refused" };
};

// A refused address is asked for again at once, up to SIGN_IN_ATTEMPTS addresses per connection (docs/10).
const connect = async (
	deps: ConnectionDeps,
	at: Target,
): Promise<Result<Session, ToolError>> => {
	for (let asked = 1; ; asked++) {
		const r = await round(deps, at);
		if (
			!r.again ||
			deps.oauthRedirectUrl ||
			asked >= SIGN_IN_ATTEMPTS ||
			at.signal.aborted
		)
			return r.result;
	}
};

const notConfigured = (id: string) =>
	Promise.resolve(
		err<ToolError>({
			code: "not_found",
			message: `no MCP server ${id} in mcp.yaml`,
		}),
	);

// A tool that reports progress is a long one; the SDK's request timeout would kill it otherwise.
// Every step reaches the log; a call in a run also publishes the steps the throttle lets through.
const callOptions =
	(deps: SessionDeps, pending: Set<Promise<void>>, lifetime: AbortSignal) =>
	(
		server: string,
		tool: string,
		ctx: ToolContext,
		capability: CapabilityRef,
	) => {
		const due = progressThrottle(deps.now ?? Date.now);
		return {
			signal: AbortSignal.any([ctx.signal, lifetime]),
			resetTimeoutOnProgress: true,
			onprogress: (p: Progress) => {
				const fields = { moduleId: deps.moduleId, server, tool };
				const logged = logProgress(deps, fields, p);
				pending.add(logged);
				void logged.then(
					() => pending.delete(logged),
					() => pending.delete(logged),
				);
				if (!deps.progress || ctx.runId === undefined || !due()) return;
				deps.progress(ctx, {
					capability,
					progress: p.progress,
					...(p.total === undefined ? {} : { total: p.total }),
				});
			},
		};
	};

// A server's sign-ins outlive its connections, so a refusal or a give-up is remembered (docs/10).
const remembered = (all: Map<string, SignInMemory>, id: string) => {
	const known = all.get(id);
	if (known) return known;
	const fresh: SignInMemory = { refused: undefined, declined: false };
	all.set(id, fresh);
	return fresh;
};

const closeClients = async (
	live: Map<string, Promise<Result<Session, ToolError>>>,
	pending: Set<Promise<void>>,
	lifetime: AbortController,
) => {
	const all = [...live.values()];
	lifetime.abort();
	live.clear();
	for (const session of await Promise.all(all))
		if (session.ok) await session.value.client.close().catch(() => {});
	await Promise.allSettled([...pending]);
};

const connectionClosed =
	(deps: SessionDeps, signal: AbortSignal, forget: () => void, id: string) =>
	() => {
		if (signal.aborted) return;
		forget();
		deps.logger.warn(
			{ moduleId: deps.moduleId, server: id },
			"MCP server connection closed",
		);
	};

/** Owns lazy connections, credential redaction and retirement for one captured configuration. */
export const createSessions = (deps: SessionDeps) => {
	const live = new Map<string, Promise<Result<Session, ToolError>>>();
	const pending = new Set<Promise<void>>();
	const signIns = new Map<string, SignInMemory>();
	let closing = false;
	const lifetime = new AbortController();
	const credentials = sessionCredentialContext(deps.mask);
	const connections: ConnectionDeps = { ...deps, ...credentials, pending };
	const drain = () => drainSessionCredentials(deps.secrets);

	const get = (id: string, signal: AbortSignal) => {
		if (closing || signal.aborted) return Promise.resolve(failed());
		const server = deps.servers.find((s) => s.id === id);
		if (!server) return notConfigured(id);
		const known = live.get(id);
		if (known) return known;
		const combined = AbortSignal.any([signal, lifetime.signal]);
		const memory = remembered(signIns, id);
		return openPendingSession(live, id, combined, (forget) =>
			connect(connections, {
				server,
				signal: combined,
				closed: connectionClosed(deps, lifetime.signal, forget, id),
				signIns: memory,
			}),
		);
	};

	return {
		get,
		close: async () => {
			closing = true;
			await closeClients(live, pending, lifetime);
			await drain();
		},
		/** Must succeed before a manager publishes a terminal sign-in state. */
		drain,
		servers: deps.servers,
		calls: deps.calls,
		/** Removes this instance's actual credential values before any output leaves it. */
		redact: credentials.redact,
		/** The options of one callTool: the run's signal, progress in the log, no timeout while it reports. */
		callOptions: callOptions(connections, pending, lifetime.signal),
	};
};

export type Sessions = ReturnType<typeof createSessions>;
