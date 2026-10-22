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
// A call that runs until the client cancels it; `cancelled` says how many it saw cancelled.
let cancelled = 0;
server.registerTool("slow", { description: "Waits 5 s" }, async (extra) => {
	await new Promise((resolve) => {
		const timer = setTimeout(resolve, 5000);
		extra.signal.addEventListener("abort", () => {
			cancelled += 1;
			clearTimeout(timer);
			resolve();
		});
	});
	return { content: [{ type: "text", text: "done" }] };
});
server.registerTool("cancelled", { description: "Cancel count" }, async () => ({
	content: [{ type: "text", text: String(cancelled) }],
}));
// Adds a tool after the client connected, so the server sends tools/list_changed.
server.registerTool("grow", { description: "Adds a tool" }, async () => {
	server.registerTool("grown", { description: "Added later" }, async () => ({
		content: [{ type: "text", text: "grown" }],
	}));
	return { content: [{ type: "text", text: "ok" }] };
});
// Reports two progress steps when the client asked for progress.
server.registerTool("steps", { description: "Two steps" }, async (extra) => {
	const progressToken = extra._meta?.progressToken;
	for (const progress of [1, 2]) {
		await extra.sendNotification({
			method: "notifications/progress",
			params: {
				progressToken,
				progress,
				total: 2,
				message: `step ${progress}`,
			},
		});
		// A real tool reports while it works; a step sent in the same tick as the result can be dropped by the client.
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	return { content: [{ type: "text", text: "ok" }] };
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
