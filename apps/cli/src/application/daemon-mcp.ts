import {
	DAEMON_METHODS,
	DaemonMcpTestParamsSchema,
	type McpStatusAdapter,
	type SecretsMaskAdapter,
} from "@mete/contracts";
import {
	ErrorCodes,
	type MessageConnection,
	ResponseError,
} from "vscode-jsonrpc/node";
import type { App } from "../infrastructure/app.js";
import { parsed, refused } from "./daemon-errors.js";

// The Settings screen's MCP servers card: Test (ADR-164). mcp-client is optional, so without it the
// answer is not_supported; no engine is needed. A failure's message passes secrets.mask@1, since a
// server's stderr may carry a token.

const maskerOf = (app: App) => {
	const masker = app.registry.resolve<SecretsMaskAdapter>("secrets.mask@1");
	if (!masker.ok)
		throw new ResponseError(
			ErrorCodes.InternalError,
			"secrets.mask@1 is not active",
		);
	return masker.value[0].impl;
};

export const serveMcpTest = (conn: MessageConnection, app: App) =>
	conn.onRequest(DAEMON_METHODS.mcpTest, async (params: unknown) => {
		const { id } = parsed(DaemonMcpTestParamsSchema.safeParse(params));
		const status = app.registry.resolve<McpStatusAdapter>("mcp.status@1");
		if (!status.ok)
			throw refused({
				code: "not_supported",
				message: "the MCP client is not running",
			});
		const mask = maskerOf(app);
		// No timeout of its own: the SDK ends the handshake and the listing after its 60 s request
		// timeout, as on a run's first call.
		const r = await status.value[0].impl.test(id, new AbortController().signal);
		if (r.ok)
			return { id, ok: true, tools: [...r.value.tools], ms: r.value.ms };
		if (r.error.code === "not_found")
			throw refused({ code: "not_found", message: r.error.message });
		const { text } = await mask.mask(r.error.message);
		return { id, ok: false, failed: { code: r.error.code, message: text } };
	});
