import { type McpStatusAdapter, ok } from "@mete/contracts";
import type { Sessions } from "./sessions.js";

// mcp.status@1 (ADR-164): the Settings card's Test connects to one server through the same session,
// runtime and sign-in as mcp.tools@1, and leaves the connection open for later calls, as `list` does.

export const mcpStatus = (sessions: Sessions): McpStatusAdapter => ({
	test: async (server, signal) => {
		const started = Date.now();
		const s = await sessions.get(server, signal);
		if (!s.ok) return s;
		return ok({
			tools: s.value.tools.map((t) => t.name),
			ms: Date.now() - started,
		});
	},
});
