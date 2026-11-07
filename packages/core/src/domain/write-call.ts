import { isWrite, type ToolCall } from "@mete/contracts";

/** Raw MCP tools have no trustworthy read-only guarantee; keep checkpoints and crash recovery. */
export const mayWrite = (call: ToolCall) =>
	call.name.startsWith("mcp_") || isWrite(call);
