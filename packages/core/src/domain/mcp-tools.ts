import type { McpToolInfo, ToolSpec } from "@mete/contracts";
import { MCP_TOOL_NAME_MAX } from "../defaults.js";

// Level 1 of docs/10, Integration levels: each tool of a configured MCP server becomes one model
// tool, mcp_<server>_<tool>, for a seat that lists mcp.tools@1.

/** A server's tool as the model sees it, and where its calls go. */
export type McpModelTool = {
	readonly spec: ToolSpec;
	readonly server: string;
	readonly tool: string;
};

/** The model tool name of a server's tool; characters providers refuse become _. */
export const mcpToolName = (server: string, tool: string) =>
	`mcp_${server}_${tool}`.replaceAll(/[^A-Za-z0-9_-]/g, "_");

const isObjectSchema = (s: unknown) =>
	typeof s === "object" && s !== null && "type" in s && s.type === "object";

const skipReason = (t: McpToolInfo, name: string, taken: boolean) => {
	if (name.length > MCP_TOOL_NAME_MAX)
		return `name longer than ${MCP_TOOL_NAME_MAX}`;
	if (taken) return "name already taken";
	return isObjectSchema(t.inputSchema)
		? undefined
		: "input schema is not an object";
};

/** The model tools of the listed MCP tools by name, and the ones left out with why. */
export const mcpModelTools = (listed: readonly McpToolInfo[]) => {
	const tools = new Map<string, McpModelTool>();
	const skipped: { server: string; tool: string; reason: string }[] = [];
	for (const t of listed) {
		const name = mcpToolName(t.server, t.name);
		const reason = skipReason(t, name, tools.has(name));
		if (reason) {
			skipped.push({ server: t.server, tool: t.name, reason });
			continue;
		}
		const description = `${t.server} MCP server: ${t.description}`;
		tools.set(name, {
			server: t.server,
			tool: t.name,
			spec: { name, description, parameters: t.inputSchema },
		});
	}
	return { tools, skipped };
};
