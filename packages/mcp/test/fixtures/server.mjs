// A small MCP server over stdio for the client tests: echo, fail and pixel.
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
await server.connect(new StdioServerTransport());
