import type { McpServer } from "@mete/contracts";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { STDERR_TAIL_CHARS } from "../defaults.js";

// Transports of docs/10 (MCP client): stdio, Streamable HTTP and legacy SSE.

/** A server's transport and the tail of what it wrote to stderr, for error messages. */
export type Opened = {
	readonly transport: Transport;
	readonly stderr: () => string;
};

/** Opens one configured server; tests swap it, or pass a fake fetch for the remote ones. */
export type OpenTransport = (
	server: McpServer,
	fetchFn?: typeof fetch,
) => Opened;

const stdio = (server: Extract<McpServer, { transport: "stdio" }>): Opened => {
	// shortcut: `runtime` is not resolved, the command runs as configured; upgrade with the runtime manager (docs/10, Managed runtimes).
	const transport = new StdioClientTransport({
		command: server.command,
		args: [...server.args],
		...(server.env ? { env: server.env } : {}),
		stderr: "pipe",
	});
	let tail = "";
	transport.stderr?.on("data", (chunk: Buffer) => {
		tail = (tail + chunk.toString()).slice(-STDERR_TAIL_CHARS);
	});
	return { transport, stderr: () => tail.trim() };
};

/** The SDK transport for a server's `transport` setting. */
export const openTransport: OpenTransport = (server, fetchFn) => {
	if (server.transport === "stdio") return stdio(server);
	const url = new URL(server.url);
	const opts = fetchFn ? { fetch: fetchFn } : {};
	// docs/10 keeps legacy SSE for older servers although the SDK deprecates it.
	const transport =
		server.transport === "sse"
			? new SSEClientTransport(url, opts)
			: new StreamableHTTPClientTransport(url, opts);
	// The SDK types `sessionId?: string` without exactOptionalPropertyTypes; the value is the same.
	return { transport: transport as Transport, stderr: () => "" };
};
