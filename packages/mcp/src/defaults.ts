// Named defaults for this package; each names the document tab that defines it (CONTRIBUTING.md).
import type { McpServer } from "@mete/contracts";

/** Tab 10, MCP client: characters of a server's stderr kept for its error messages. */
export const STDERR_TAIL_CHARS = 2000;

/** Tab 10, MCP client: servers every workspace has; an mcp.yaml entry with the same id replaces one. */
export const BUILT_IN_SERVERS: readonly McpServer[] = [
	{
		id: "exa",
		transport: "streamable-http",
		url: "https://mcp.exa.ai/mcp?tools=web_search_advanced_exa",
		auth: "none",
		permissions: [],
	},
];
