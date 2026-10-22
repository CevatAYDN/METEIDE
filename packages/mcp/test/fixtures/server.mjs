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
// Asks the client's model a question (sampling) and answers with the model's name and words.
server.registerTool("summon", { description: "Asks a model" }, async () => {
	const r = await server.server.createMessage({
		messages: [{ role: "user", content: { type: "text", text: "Say hi" } }],
		systemPrompt: "Be brief",
		maxTokens: 20,
		temperature: 0.2,
		modelPreferences: { intelligencePriority: 0.9 },
	});
	const words = r.content.type === "text" ? r.content.text : r.content.type;
	return { content: [{ type: "text", text: `${r.model}: ${words}` }] };
});
// Asks the user a name through the client (elicitation) and answers with it, or with what they did instead.
server.registerTool("ask", { description: "Asks a name" }, async () => {
	const r = await server.server.elicitInput({
		message: "Who are you?",
		requestedSchema: {
			type: "object",
			properties: { name: { type: "string" } },
			required: ["name"],
		},
	});
	const text = r.action === "accept" ? String(r.content?.name) : r.action;
	return { content: [{ type: "text", text }] };
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
	async ({ query, numResults }, extra) => {
		const progressToken = extra._meta?.progressToken;
		if (progressToken !== undefined) {
			await extra.sendNotification({
				method: "notifications/progress",
				params: { progressToken, progress: 1, total: 1 },
			});
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		// A contract kit sets the hits or an outage through the environment.
		if (process.env.EXA_DOWN)
			return {
				content: [{ type: "text", text: "backend down" }],
				isError: true,
			};
		const given = process.env.EXA_HITS;
		if (given) {
			const hits = JSON.parse(given).slice(0, numResults);
			const results = hits.map(({ snippet, ...hit }) => ({
				...hit,
				highlights: [snippet],
			}));
			return { content: [{ type: "text", text: JSON.stringify({ results }) }] };
		}
		const results = Array.from({ length: Math.min(numResults, 2) }, (_, i) => ({
			title: query,
			url: `https://r${i}.example/`,
			highlights: ["one", "two"],
		}));
		return { content: [{ type: "text", text: JSON.stringify({ results }) }] };
	},
);
await server.connect(new StdioServerTransport());
