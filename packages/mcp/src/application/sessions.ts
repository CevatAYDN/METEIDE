import { delimiter } from "node:path";
import { pathToFileURL } from "node:url";
import {
	err,
	type McpServer,
	ok,
	type Result,
	type RuntimeEnsureAdapter,
	type SecretStore,
	type ToolError,
} from "@mete/contracts";
import type { Logger } from "@mete/kernel";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
	CreateMessageRequestSchema,
	type ElicitRequestFormParams,
	ElicitRequestSchema,
	type ElicitResult,
	type ListChangedCallback,
	ListRootsRequestSchema,
	type Progress,
	type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { oauthSignIn, type SignInFlow } from "../infrastructure/oauth.js";
import type { Opened, OpenTransport } from "../infrastructure/transport.js";
import type { Calls } from "./calls.js";
import type { Sample } from "./sampling.js";
import { type Authorize, signIn } from "./sign-in.js";

// One connection per configured server, opened on first use so a run pays only for the
// servers it calls; a closed connection is dropped and the next call reconnects (docs/10).

/** A connected server and the tools it listed when it connected. */
export type Session = {
	readonly client: Client;
	readonly tools: readonly Tool[];
};

/** Asks the user for a server: the answer is accept (with the filled form), decline or cancel (docs/10, Elicitation). */
export type Elicit = (
	server: string,
	params: ElicitRequestFormParams,
	signal: AbortSignal,
) => Promise<ElicitResult>;

export type SessionDeps = {
	readonly moduleId: string;
	readonly version: string;
	readonly servers: readonly McpServer[];
	/** The workspace root: where a stdio server starts and the one root every server is told (docs/10, Roots). */
	readonly workspaceDir: string;
	readonly open: OpenTransport;
	readonly fetch?: typeof fetch;
	readonly logger: Logger;
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
};

const why = (e: unknown) => (e instanceof Error ? e.message : String(e));

const io = (server: string, e: unknown, stderr: string): ToolError => ({
	code: "io",
	message: `MCP server ${server}: ${why(e)}${stderr ? `; stderr: ${stderr}` : ""}`,
});

// The runtime's folder goes first on PATH, so npx, uvx or docker runs as configured (docs/10).
const withRuntime = async (
	deps: SessionDeps,
	server: McpServer,
	signal: AbortSignal,
): Promise<Result<McpServer, ToolError>> => {
	if (server.transport !== "stdio" || !deps.ensure) return ok(server);
	const { runtime, url = "", sha256 = "" } = server;
	const input = runtime === "binary" ? { runtime, url, sha256 } : { runtime };
	const r = await deps.ensure.run(input, { signal });
	if (!r.ok)
		return err({
			...r.error,
			message: `MCP server ${server.id}: ${r.error.message}`,
		});
	const path = server.env?.PATH ?? process.env.PATH ?? "";
	const PATH = `${r.value.binDir}${delimiter}${path}`;
	return ok({ ...server, env: { ...server.env, PATH } });
};

const onToolsChanged =
	(
		deps: SessionDeps,
		server: McpServer,
		state: { tools: readonly Tool[] },
	): ListChangedCallback<Tool> =>
	(error, tools) => {
		const at = { moduleId: deps.moduleId, server: server.id };
		if (!tools)
			return deps.logger.warn(
				{ ...at, reason: error?.message ?? "" },
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
	deps: SessionDeps,
	server: McpServer,
	state: { tools: readonly Tool[] },
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
	client.setRequestHandler(ListRootsRequestSchema, () => ({ roots: [root] }));
	if (sample)
		client.setRequestHandler(CreateMessageRequestSchema, ({ params }, extra) =>
			sample(server.id, params, extra.signal),
		);
	if (elicit)
		client.setRequestHandler(ElicitRequestSchema, ({ params }, extra) =>
			params.mode === "url"
				? { action: "decline" }
				: elicit(server.id, params, extra.signal),
		);
	return client;
};

/** The server to connect to, how to stop waiting for it, and what to do when its connection closes. */
type Target = {
	readonly server: McpServer;
	readonly signal: AbortSignal;
	readonly closed: (stderr: string) => void;
};

// A remote server with `auth: oauth` signs in through the keychain (docs/10, Authentication).
const oauthFlow = (
	deps: SessionDeps,
	server: McpServer,
): Result<SignInFlow | undefined, ToolError> => {
	if (server.transport === "stdio" || server.auth !== "oauth")
		return ok(undefined);
	if (!deps.secrets)
		return err({
			code: "io",
			message: `MCP server ${server.id}: OAuth sign-in needs the keychain, which this module was not given`,
		});
	return ok(oauthSignIn(deps.secrets, new URL(server.url)));
};

type Tried = {
	readonly result: Result<Session, ToolError>;
	readonly refused?: Opened;
};

// One try at a connection. A server that answers 401 while a sign-in flow is ready hands back its transport.
const attempt = async (
	deps: SessionDeps,
	{ server, signal, closed }: Target,
	flow: SignInFlow | undefined,
): Promise<Tried> => {
	const ready = await withRuntime(deps, server, signal);
	if (!ready.ok) return { result: ready };
	const opened = deps.open(ready.value, {
		cwd: deps.workspaceDir,
		...(deps.fetch ? { fetch: deps.fetch } : {}),
		...(flow ? { auth: flow.provider } : {}),
	});
	const state: { tools: readonly Tool[] } = { tools: [] };
	const client = newClient(deps, server, state);
	try {
		await client.connect(opened.transport, { signal });
		state.tools = (await client.listTools(undefined, { signal })).tools;
		client.onclose = () => closed(opened.stderr());
		const tools = () => state.tools;
		return {
			result: ok({
				client,
				get tools() {
					return tools();
				},
			}),
		};
	} catch (e) {
		await client.close().catch(() => {});
		const result = err(io(server.id, e, opened.stderr()));
		return flow && e instanceof UnauthorizedError
			? { result, refused: opened }
			: { result };
	}
};

// A server that wants a sign-in gets one, then one more try with the tokens it earned.
const connect = async (
	deps: SessionDeps,
	at: Target,
): Promise<Result<Session, ToolError>> => {
	const flow = oauthFlow(deps, at.server);
	if (!flow.ok) return flow;
	const first = await attempt(deps, at, flow.value);
	if (!first.refused || !flow.value) return first.result;
	const refused = {
		server: at.server,
		flow: flow.value,
		opened: first.refused,
	};
	const done = await signIn(deps.authorize, refused, at.signal);
	return done.ok ? (await attempt(deps, at, flow.value)).result : done;
};

const notConfigured = (id: string) =>
	Promise.resolve(
		err<ToolError>({
			code: "not_found",
			message: `no MCP server ${id} in mcp.yaml`,
		}),
	);

// A tool that reports progress is a long one; the SDK's request timeout would kill it otherwise.
// shortcut: progress reaches the log only; upgrade with the team panel (Phase 5, docs/10).
const callOptions =
	(deps: SessionDeps) =>
	(server: string, tool: string, signal: AbortSignal) => ({
		signal,
		resetTimeoutOnProgress: true,
		onprogress: (p: Progress) =>
			deps.logger.info(
				{ moduleId: deps.moduleId, server, tool, ...p },
				"MCP tool progress",
			),
	});

export const createSessions = (deps: SessionDeps) => {
	const live = new Map<string, Promise<Result<Session, ToolError>>>();
	let closing = false;

	const get = (id: string, signal: AbortSignal) => {
		const server = deps.servers.find((s) => s.id === id);
		if (!server) return notConfigured(id);
		const known = live.get(id);
		if (known) return known;
		// Only this connection's own entry is dropped, so a newer one survives an old close.
		const forget = () => {
			if (live.get(id) === opening) live.delete(id);
		};
		const closed = (stderr: string) => {
			if (closing) return;
			forget();
			deps.logger.warn(
				{ moduleId: deps.moduleId, server: id, stderr },
				"MCP server connection closed",
			);
		};
		const opening = connect(deps, { server, signal, closed }).then((r) => {
			if (!r.ok) forget();
			return r;
		});
		live.set(id, opening);
		return opening;
	};

	const close = async () => {
		closing = true;
		const all = [...live.values()];
		live.clear();
		for (const s of await Promise.all(all))
			if (s.ok) await s.value.client.close().catch(() => {});
	};

	return {
		get,
		close,
		servers: deps.servers,
		calls: deps.calls,
		/** The options of one callTool: the run's signal, progress in the log, no timeout while it reports. */
		callOptions: callOptions(deps),
	};
};

export type Sessions = ReturnType<typeof createSessions>;
