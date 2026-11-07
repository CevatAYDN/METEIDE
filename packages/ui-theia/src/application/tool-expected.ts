import { McpConfigSchema, type McpServer } from "@mete/contracts";
import { parse } from "yaml";
import { type McpServerDraft, serversText } from "./mcp-draft.js";

/** Exact user draft sent only to the local daemon for a secret-safe effective-config comparison. */
export const expectedTool = (
	draft: McpServerDraft | undefined,
): McpServer | undefined => {
	if (!draft) return undefined;
	const text = serversText(undefined, "workspace", [draft]);
	if (!text.ok) return undefined;
	const parsed = McpConfigSchema.safeParse(parse(text.value));
	return parsed.success ? parsed.data.servers[0] : undefined;
};
