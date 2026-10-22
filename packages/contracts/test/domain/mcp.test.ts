import { describe, expect, it } from "vitest";
import { McpCallInputSchema, McpConfigSchema } from "../../src/domain/mcp.js";

describe(".mete/mcp.yaml", () => {
	it("takes stdio and remote servers with their defaults", () => {
		const c = McpConfigSchema.parse({
			servers: [
				{
					id: "blender",
					transport: "stdio",
					runtime: "python",
					command: "uvx",
					args: ["blender-mcp==1.0.0"],
					permissions: ["fs.read"],
				},
				{
					id: "exa",
					transport: "streamable-http",
					url: "https://mcp.exa.ai/mcp",
				},
			],
		});
		expect(c.servers[1]).toEqual({
			id: "exa",
			transport: "streamable-http",
			url: "https://mcp.exa.ai/mcp",
			auth: "none",
			permissions: [],
		});
		expect(McpConfigSchema.parse(undefined)).toEqual({ servers: [] });
	});

	it("refuses a duplicate id, an unknown runtime, a non-web url and extra keys", () => {
		const s = { id: "a", transport: "stdio", runtime: "node", command: "npx" };
		for (const bad of [
			{ servers: [s, s] },
			{ servers: [{ ...s, runtime: "ruby" }] },
			{ servers: [{ id: "b", transport: "sse", url: "file:///x" }] },
			{ servers: [{ ...s, shell: true }] },
			{ servers: [{ ...s, runtime: "binary" }] },
			{
				servers: [
					{ ...s, url: "https://a.example/t.zip", sha256: "a".repeat(64) },
				],
			},
			{
				servers: [
					{
						...s,
						runtime: "binary",
						url: "http://a.example/t.zip",
						sha256: "a".repeat(64),
					},
				],
			},
		])
			expect(McpConfigSchema.safeParse(bad).success).toBe(false);
	});
});

it("takes a binary server with its https download and hash", () => {
	const binary = {
		id: "tool",
		transport: "stdio",
		runtime: "binary",
		command: "tool",
		url: "https://a.example/tool.zip",
		sha256: "a".repeat(64),
	};
	expect(McpConfigSchema.safeParse({ servers: [binary] }).success).toBe(true);
});

describe("mcp.tools@1 call input", () => {
	it("defaults the arguments to an empty object", () => {
		expect(
			McpCallInputSchema.parse({ server: "exa", tool: "web_search_exa" }),
		).toEqual({
			server: "exa",
			tool: "web_search_exa",
			args: {},
		});
	});
});
