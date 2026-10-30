import type { McpServer } from "@mete/contracts";
import {
	type OAuthClientProvider,
	SSEClientTransport,
	StreamableHTTPClientTransport,
	type Transport,
} from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { STDERR_TAIL_CHARS } from "../defaults.js";

// Transports of docs/10 (MCP client): stdio, Streamable HTTP and legacy SSE.

/** A server's transport, the tail of what it wrote to stderr for error messages, and how to finish a sign-in. */
export type Opened = {
	readonly transport: Transport;
	readonly stderr: () => string;
	/** Remote transports only: exchanges the authorization code for tokens, so the next connection is signed in; the SDK checks `iss` against the server's issuer (RFC 9207). */
	readonly finishAuth?: (code: string, iss?: string) => Promise<void>;
};

/** What a transport is opened with: a fake fetch for remote servers, the folder a stdio server starts in, an OAuth provider. */
export type OpenOptions = {
	readonly fetch?: typeof fetch;
	readonly cwd?: string;
	readonly auth?: OAuthClientProvider;
};

/** Opens one configured server; tests swap it. */
export type OpenTransport = (server: McpServer, opts?: OpenOptions) => Opened;

const stdio = (
	server: Extract<McpServer, { transport: "stdio" }>,
	cwd?: string,
): Opened => {
	const transport = new StdioClientTransport({
		command: server.command,
		args: [...server.args],
		...(server.env ? { env: server.env } : {}),
		...(cwd ? { cwd } : {}),
		stderr: "pipe",
	});
	let tail = "";
	transport.stderr?.on("data", (chunk: Buffer) => {
		tail = (tail + chunk.toString()).slice(-STDERR_TAIL_CHARS);
	});
	return { transport, stderr: () => tail.trim() };
};

/** The SDK transport for a server's `transport` setting. */
export const openTransport: OpenTransport = (server, opts = {}) => {
	if (server.transport === "stdio") return stdio(server, opts.cwd);
	const url = new URL(server.url);
	const more = {
		...(opts.fetch ? { fetch: opts.fetch } : {}),
		...(opts.auth ? { authProvider: opts.auth } : {}),
	};
	// docs/10 keeps legacy SSE for older servers although the SDK deprecates it.
	const transport =
		server.transport === "sse"
			? new SSEClientTransport(url, more)
			: new StreamableHTTPClientTransport(url, more);
	return {
		transport,
		stderr: () => "",
		finishAuth: (code, iss) => transport.finishAuth(code, iss),
	};
};
