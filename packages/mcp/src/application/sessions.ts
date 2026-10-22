import {
	err,
	type McpServer,
	ok,
	type Result,
	type ToolError,
} from "@mete/contracts";
import type { Logger } from "@mete/kernel";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { OpenTransport } from "../infrastructure/transport.js";

// One connection per configured server, opened on first use so a run pays only for the
// servers it calls; a closed connection is dropped and the next call reconnects (docs/10).

/** A connected server and the tools it listed when it connected. */
export type Session = {
	readonly client: Client;
	readonly tools: readonly Tool[];
};

export type SessionDeps = {
	readonly moduleId: string;
	readonly version: string;
	readonly servers: readonly McpServer[];
	readonly open: OpenTransport;
	readonly logger: Logger;
};

const why = (e: unknown) => (e instanceof Error ? e.message : String(e));

const io = (server: string, e: unknown, stderr: string): ToolError => ({
	code: "io",
	message: `MCP server ${server}: ${why(e)}${stderr ? `; stderr: ${stderr}` : ""}`,
});

const unsupported = (server: McpServer): ToolError | undefined =>
	server.transport !== "stdio" && server.auth === "oauth"
		? {
				code: "io",
				// shortcut: OAuth is not wired yet; upgrade with the OAuth slice (docs/10, Authentication).
				message: `MCP server ${server.id}: OAuth sign-in is not supported yet`,
			}
		: undefined;

const connect = async (
	deps: SessionDeps,
	server: McpServer,
	signal: AbortSignal,
	closed: (stderr: string) => void,
): Promise<Result<Session, ToolError>> => {
	const refused = unsupported(server);
	if (refused) return err(refused);
	const { transport, stderr } = deps.open(server);
	const client = new Client({ name: "mete", version: deps.version });
	try {
		await client.connect(transport, { signal });
		// shortcut: the list is read once per connection; upgrade with list-change notifications (docs/10).
		const { tools } = await client.listTools(undefined, { signal });
		client.onclose = () => closed(stderr());
		return ok({ client, tools });
	} catch (e) {
		await client.close().catch(() => {});
		return err(io(server.id, e, stderr()));
	}
};

const notConfigured = (id: string) =>
	Promise.resolve(
		err<ToolError>({
			code: "not_found",
			message: `no MCP server ${id} in mcp.yaml`,
		}),
	);

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
		const opening = connect(deps, server, signal, (stderr) => {
			if (closing) return;
			forget();
			deps.logger.warn(
				{ moduleId: deps.moduleId, server: id, stderr },
				"MCP server connection closed",
			);
		}).then((r) => {
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

	return { get, close, servers: deps.servers };
};

export type Sessions = ReturnType<typeof createSessions>;
