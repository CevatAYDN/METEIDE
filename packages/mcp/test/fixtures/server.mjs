// A small MCP server over stdio for the client tests: echo, fail, pixel, where and an Exa-like search.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// A 1x1 PNG.
const PIXEL =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const server = new McpServer({ name: "fixture", version: "1.0.0" });
server.registerTool(
	"echo",
	{ description: "Echoes the text", inputSchema: { text: z.string() } },
	async ({ text }) => ({ content: [{ type: "text", text }] }),
);
server.registerTool("fail", { description: "Always fails" }, async () => ({
	content: [{ type: "text", text: "it broke" }],
	isError: true,
}));
server.registerTool("pixel", { description: "One image" }, async () => ({
	content: [{ type: "image", data: PIXEL, mimeType: "image/png" }],
}));
// Answers with the folder it started in and the roots the client lists.
server.registerTool("where", { description: "Cwd and roots" }, async () => {
	const { roots } = await server.server.listRoots();
	const text = JSON.stringify({ cwd: process.cwd(), roots });
	return { content: [{ type: "text", text }] };
});
// Answers like Exa's web_search_advanced_exa: the results as JSON text, the query as each title.
server.registerTool(
	"web_search_advanced_exa",
	{
		description: "JSON results",
		inputSchema: { query: z.string(), numResults: z.number() },
	},
	async ({ query, numResults }) => {
		const results = Array.from({ length: Math.min(numResults, 2) }, (_, i) => ({
			title: query,
			url: `https://r${i}.example/`,
			highlights: ["one", "two"],
		}));
		return { content: [{ type: "text", text: JSON.stringify({ results }) }] };
	},
);
await server.connect(new StdioServerTransport());
