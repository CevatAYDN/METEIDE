import {
	DAEMON_METHODS,
	type McpConnectionAdapter,
	type McpConnectionRequest,
	McpConnectionRequestSchema,
	type McpSignInStarted,
	McpSignInStartedSchema,
} from "@mete/contracts";
import type { MessageConnection } from "vscode-jsonrpc/node";
import type { App } from "../infrastructure/app.js";
import { refused } from "./daemon-errors.js";
import { matchesLoadedServer, serveMcpTest } from "./daemon-mcp.js";
import { admitManagement } from "./daemon-quiesce.js";

type Host = Pick<App, "config" | "registry">;

const manage = async (
	adapter: McpConnectionAdapter,
	input: McpConnectionRequest,
) => {
	const signal = new AbortController().signal;
	if (input.op === "start") return adapter.start(input.expected, signal);
	const result =
		input.op === "cancel"
			? await adapter.cancel(input.expected, input.attemptId)
			: input.op === "forget"
				? await adapter.forget(input.expected, signal)
				: await adapter.status(input.expected, signal);
	return result.ok
		? { ok: true as const, value: { state: result.value } }
		: result;
};

/** Explicit user management; status never connects and writes require an idle daemon. */
export const connectionRequest = async (
	app: Host,
	raw: unknown,
): Promise<McpSignInStarted> => {
	const parsed = McpConnectionRequestSchema.safeParse(raw);
	if (!parsed.success)
		throw refused({
			code: "bad_input",
			message: "Invalid MCP management request",
		});
	const input = parsed.data;
	if (!matchesLoadedServer(app, input.expected.id, input.expected))
		throw refused({
			code: "not_found",
			message:
				"The server differs from the active configuration; save and apply it first",
		});
	const found = app.registry.resolve<McpConnectionAdapter>("mcp.connection@1");
	if (!found.ok)
		throw refused({
			code: "not_supported",
			message: "MCP connection management is unavailable",
		});
	if (input.op === "start" || input.op === "forget") await admitManagement(app);
	const result = await manage(found.value[0].impl, input);
	if (!result.ok)
		throw refused({
			code: "failed",
			message: "MCP connection action failed; retry or check the server setup",
		});
	const output = McpSignInStartedSchema.safeParse(result.value);
	if (!output.success)
		throw refused({
			code: "failed",
			message: "Invalid MCP management response",
		});
	return output.data;
};

/** Legacy probe and protocol33 management routes; neither is a model tool. */
export const serveMcpConnection = (conn: MessageConnection, app: App) => {
	serveMcpTest(conn, app);
	return conn.onRequest(DAEMON_METHODS.mcpConnection, (raw: unknown) =>
		connectionRequest(app, raw),
	);
};
