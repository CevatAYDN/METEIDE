import { delimiter } from "node:path";
import {
	err,
	type McpServer,
	ok,
	type Result,
	type RuntimeEnsureAdapter,
	type SecretStore,
	type SecretsMaskAdapter,
	type ToolError,
} from "@mete/contracts";
import type { Client, Tool } from "@modelcontextprotocol/client";
import { credentialFetch } from "../infrastructure/credential-fetch.js";
import {
	createCredentialFields,
	redactCredentials,
} from "../infrastructure/credential-fields.js";
import { credentialTargetAllowed } from "../infrastructure/credential-identity.js";
import { createCredentialRecords } from "../infrastructure/credential-records.js";
import { oauthSignIn, type SignInFlow } from "../infrastructure/oauth.js";
import type { Opened } from "../infrastructure/transport.js";
import type { Authorize } from "./sign-in.js";

type Options = {
	readonly workspaceDir: string;
	readonly secrets?: SecretStore;
	readonly ensure?: RuntimeEnsureAdapter;
	readonly fetch?: typeof fetch;
	readonly authorize?: Authorize;
	readonly oauthRedirectUrl?: string;
	readonly onSecrets: (values: readonly string[]) => void;
};
/** Private, exact-target connection material; never returned through management or tools. */
export type PreparedSessionCredentials = {
	readonly server: McpServer;
	readonly flow: SignInFlow | undefined;
	readonly fetch?: typeof fetch;
	readonly credentialEndpoints?: Set<string>;
};
const failed = (message: string) => err<ToolError>({ code: "io", message });

/** Waits only for shared keychain work, retaining a sanitized rollback/cleanup failure. */
export const drainSessionCredentials = async (
	secrets: SecretStore | undefined,
): Promise<Result<void, ToolError>> => {
	try {
		const result = secrets
			? await createCredentialRecords(secrets).settled()
			: ok(undefined);
		return result.ok ? ok(undefined) : failed("MCP credential cleanup failed");
	} catch {
		return failed("MCP credential cleanup failed");
	}
};
type Channels = {
	readonly env: Record<string, string>;
	readonly headers: Record<string, string>;
};

/** Keeps observed values instance-local and redacts them before the generic mask. */
export const sessionCredentialContext = (
	mask: SecretsMaskAdapter | undefined,
) => {
	const secrets = new Set<string>();
	const redact = (text: string) => redactCredentials(text, [...secrets]);
	return {
		redact,
		onSecrets: (values: readonly string[]) => {
			for (const value of values) secrets.add(value);
		},
		...(mask
			? { mask: { mask: (text: string) => mask.mask(redact(text)) } }
			: {}),
	};
};

const fieldsFor = async (
	deps: Options,
	server: McpServer,
): Promise<Result<Channels, ToolError>> => {
	const loaded = deps.secrets
		? await createCredentialFields(deps.secrets, deps.workspaceDir).load(server)
		: ok(undefined);
	if (!loaded.ok) return loaded;
	const fields = loaded.value?.fields ?? server.credentialFields ?? [];
	const values = loaded.value?.values ?? {};
	deps.onSecrets(Object.values(values));
	if (
		fields.some(
			(field) => field.required && !values[`${field.kind}:${field.name}`],
		)
	)
		return failed(
			"Required MCP credentials are missing; configure them in Settings",
		);
	const env: Record<string, string> = {};
	const headers: Record<string, string> = {};
	const channels = { env, header: headers };
	for (const field of fields) {
		const value = values[`${field.kind}:${field.name}`];
		if (value !== undefined) channels[field.kind][field.name] = value;
	}
	return ok({ env, headers });
};

const withRuntime = async (
	deps: Options,
	server: McpServer,
	signal: AbortSignal,
) => {
	if (server.transport !== "stdio" || !deps.ensure) return ok(server);
	const { runtime, url = "", sha256 = "" } = server;
	const input = runtime === "binary" ? { runtime, url, sha256 } : { runtime };
	const ready = await deps.ensure.run(input, { signal });
	if (!ready.ok)
		return err({
			...ready.error,
			message: `MCP server ${server.id}: ${redactCredentials(ready.error.message, Object.values(server.env ?? {}))}`,
		});
	const path = server.env?.PATH ?? process.env.PATH ?? "";
	return ok({
		...server,
		env: { ...server.env, PATH: `${ready.value.binDir}${delimiter}${path}` },
	});
};

const oauthFlow = async (
	deps: Options,
	server: McpServer,
	signal: AbortSignal,
): Promise<Result<SignInFlow | undefined, ToolError>> => {
	if (server.transport === "stdio" || server.auth !== "oauth")
		return ok(undefined);
	if (!deps.secrets)
		return failed("MCP OAuth requires the operating-system keychain");
	return oauthSignIn({
		secrets: deps.secrets,
		workspaceDir: deps.workspaceDir,
		server,
		signal,
		interactive: Boolean(deps.authorize),
		...(deps.oauthRedirectUrl ? { redirectUrl: deps.oauthRedirectUrl } : {}),
		onSecrets: deps.onSecrets,
	});
};

const fetchWithCredentials = (
	fetcher: typeof fetch | undefined,
	endpoint: string,
	headers: Record<string, string>,
	target: {
		readonly signal: AbortSignal;
		readonly credentialEndpoints?: Set<string>;
	},
) =>
	credentialFetch(fetcher ?? fetch, {
		endpoint,
		headers,
		signal: target.signal,
		...(target.credentialEndpoints
			? { endpoints: target.credentialEndpoints }
			: {}),
	});

const transportCredentials = (
	deps: Options,
	server: McpServer,
	fields: Channels,
	signal: AbortSignal,
): Result<Omit<PreparedSessionCredentials, "flow">, ToolError> => {
	if (server.transport === "stdio")
		return ok({
			server: { ...server, env: { ...server.env, ...fields.env } },
			...(deps.fetch ? { fetch: deps.fetch } : {}),
		});
	const secured =
		server.auth === "oauth" || Object.keys(fields.headers).length > 0;
	if (secured && !credentialTargetAllowed(server))
		return failed("MCP authentication requires a secure target");
	const destinations =
		secured && server.transport === "sse"
			? { credentialEndpoints: new Set<string>() }
			: {};
	const fetcher = secured
		? fetchWithCredentials(deps.fetch, server.url, fields.headers, {
				signal,
				...destinations,
			})
		: deps.fetch;
	return ok({
		server,
		...destinations,
		...(fetcher ? { fetch: fetcher } : {}),
	});
};

/** Abort and shutdown share the original close promise, including Windows child exit. */
export const trackSessionClose = (
	client: Pick<Client, "close">,
	pending: Set<Promise<void>>,
): void => {
	const close = client.close.bind(client);
	let closing: Promise<void> | undefined;
	client.close = () => {
		if (closing) return closing;
		closing = close();
		const captured = closing;
		pending.add(captured);
		void captured.then(
			() => pending.delete(captured),
			() => pending.delete(captured),
		);
		return captured;
	};
};

/** Closes either the client or a transport that failed before client ownership began. */
export const closeSessionTransport = async (
	client: Client | undefined,
	opened: Opened | undefined,
) => {
	await (client?.close() ?? opened?.transport.close())?.catch(() => {});
};

const retainSession = (
	signal: AbortSignal,
	client: Client,
	retire: () => void,
) => {
	const abort = () => {
		retire();
		void client.close().catch(() => {});
	};
	const closed = client.onclose;
	client.onclose = () => {
		signal.removeEventListener("abort", abort);
		closed?.();
	};
	signal.addEventListener("abort", abort, { once: true });
	if (signal.aborted) {
		signal.removeEventListener("abort", abort);
		abort();
	}
};

/** Cancellation settles a pending get even when its adapter has not returned yet. */
export const pendingSessionConnection = (
	signal: AbortSignal,
	connect: () => Promise<
		Result<
			{ readonly client: Client; readonly tools: readonly Tool[] },
			ToolError
		>
	>,
	retire: () => void,
) => {
	const waiting = Promise.withResolvers<Awaited<ReturnType<typeof connect>>>();
	const abort = () => {
		retire();
		waiting.resolve(failed("MCP connection cancelled"));
	};
	signal.addEventListener("abort", abort, { once: true });
	if (signal.aborted) abort();
	void connect().then(
		(result) => {
			signal.removeEventListener("abort", abort);
			if (result.ok) retainSession(signal, result.value.client, retire);
			waiting.resolve(
				signal.aborted ? failed("MCP connection cancelled") : result,
			);
		},
		() => {
			signal.removeEventListener("abort", abort);
			waiting.resolve(failed("MCP connection failed"));
		},
	);
	return waiting.promise;
};

/** Loads requirements before runtime work; injects only into the captured child or endpoint. */
export const prepareSessionCredentials = async (
	deps: Options,
	server: McpServer,
	signal: AbortSignal,
): Promise<Result<PreparedSessionCredentials, ToolError>> => {
	try {
		if (signal.aborted) return failed("MCP connection cancelled");
		const fields = await fieldsFor(deps, server);
		if (!fields.ok) return fields;
		const transport = transportCredentials(deps, server, fields.value, signal);
		if (!transport.ok) return transport;
		const flow = await oauthFlow(deps, server, signal);
		if (!flow.ok) return flow;
		if (signal.aborted) return failed("MCP connection cancelled");
		const ready = await withRuntime(deps, transport.value.server, signal);
		if (!ready.ok) return ready;
		if (signal.aborted) return failed("MCP connection cancelled");
		return ok({
			...transport.value,
			server: ready.value,
			flow: flow.value,
		});
	} catch {
		return failed(
			"MCP credential or runtime preparation failed; check Settings or the terminal",
		);
	}
};

/** Commits staged tokens only after the exact transport's handshake and tools/list succeed. */
export const connectAndCommit = async (
	client: Client,
	opened: Opened,
	signal: AbortSignal,
	flow: SignInFlow | undefined,
): Promise<Result<Tool[], ToolError>> => {
	const abort = () => {
		void client.close().catch(() => {});
	};
	signal.addEventListener("abort", abort, { once: true });
	try {
		if (signal.aborted) return failed("MCP connection cancelled");
		await client.connect(opened.transport, { signal });
		if (signal.aborted) return failed("MCP connection cancelled");
		const { tools } = await client.listTools(undefined, { signal });
		if (signal.aborted) return failed("MCP connection cancelled");
		const saved = flow ? await flow.commit() : ok(undefined);
		if (!saved.ok) return failed("MCP OAuth credential commit failed");
		return signal.aborted ? failed("MCP connection cancelled") : ok(tools);
	} finally {
		signal.removeEventListener("abort", abort);
	}
};

/** Unknown SDK errors are omitted; stderr crosses this boundary only after masking. */
export const sessionConnectionError = async (
	server: string,
	stderr: string,
	mask?: SecretsMaskAdapter,
): Promise<ToolError> => {
	let diagnostic = "";
	if (stderr && mask) {
		try {
			diagnostic = (await mask.mask(stderr)).text;
		} catch {
			diagnostic = "";
		}
	}
	return {
		code: "io",
		message: `MCP server ${server}: connection failed${diagnostic ? `; stderr: ${diagnostic}` : ""}`,
	};
};
