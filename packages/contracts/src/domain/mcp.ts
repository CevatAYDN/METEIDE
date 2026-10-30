import { z } from "zod";
import { PermissionSchema } from "./manifest.js";
import type { Result } from "./result.js";
import type { ToolContext, ToolError } from "./tools.js";

// .mete/mcp.yaml and mcp.tools@1 from docs/10 (MCP client); raw calls are level 1 integration.

const text = z.string().min(1);
const serverId = z
	.string()
	.regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "expected a kebab-case server id");
const permissions = z
	.array(PermissionSchema)
	.readonly()
	.default(() => []);

// A binary server names the https download and its SHA-256 (runtime.ensure@1); no other runtime does.
const StdioServerSchema = z
	.strictObject({
		id: serverId,
		transport: z.literal("stdio"),
		runtime: z.enum(["node", "python", "binary", "container"]),
		command: text,
		args: z
			.array(z.string())
			.readonly()
			.default(() => []),
		env: z.record(z.string(), z.string()).optional(),
		url: z.url({ protocol: /^https$/ }).optional(),
		sha256: z
			.string()
			.regex(/^[0-9a-f]{64}$/, "expected a lowercase SHA-256")
			.optional(),
		permissions,
	})
	.refine(
		(s) =>
			(s.runtime === "binary") ===
			(s.url !== undefined && s.sha256 !== undefined),
		{
			message:
				"a binary server needs url and sha256, and only a binary server has them",
			path: ["runtime"],
		},
	);

const RemoteServerSchema = z.strictObject({
	id: serverId,
	transport: z.enum(["streamable-http", "sse"]),
	url: z.url({ protocol: /^https?$/ }),
	auth: z.enum(["oauth", "none"]).default("none"),
	permissions,
});

/** One MCP server: a local process over stdio, or a remote one over HTTP. */
export const McpServerSchema = z.union([StdioServerSchema, RemoteServerSchema]);
export type McpServer = z.output<typeof McpServerSchema>;

/** The `mcp:` settings section and `.mete/mcp.yaml`; server ids are unique. */
export const McpConfigSchema = z
	.strictObject({
		servers: z
			.array(McpServerSchema)
			.readonly()
			.default(() => []),
	})
	.refine(
		(c) => new Set(c.servers.map((s) => s.id)).size === c.servers.length,
		{ message: "server ids must be unique", path: ["servers"] },
	)
	.prefault({});
export type McpConfig = z.output<typeof McpConfigSchema>;

/** Input of mcp.tools@1 call: one tool of one configured server, by name. */
export const McpCallInputSchema = z.strictObject({
	server: text,
	tool: text,
	args: z.record(z.string(), z.unknown()).default(() => ({})),
});
export type McpCallInput = z.input<typeof McpCallInputSchema>;

/** A tool a server lists. */
export type McpToolInfo = {
	readonly server: string;
	readonly name: string;
	readonly description: string;
	readonly inputSchema: unknown;
};

/** What a tool returned; an image is saved in .mete/assets/ and named by its path. */
export type McpContent =
	| { readonly type: "text"; readonly text: string }
	| {
			readonly type: "image";
			readonly mediaType: string;
			readonly path: string;
	  }
	| {
			readonly type: "resource";
			readonly uri: string;
			readonly mimeType?: string;
	  };

/** A tool call's result; isError is the server's own error flag. */
export type McpCallOutput = {
	readonly content: readonly McpContent[];
	readonly isError: boolean;
};

/** What mcp.status@1 found: the names of the tools the server lists, in its order, and how long connecting took. */
export type McpServerTest = {
	readonly tools: readonly string[];
	readonly ms: number;
};

/** mcp.status@1: connects to one configured server as mcp.tools@1 does (ADR-164); `not_found` for an id not loaded. */
export interface McpStatusAdapter {
	test(
		server: string,
		signal: AbortSignal,
	): Promise<Result<McpServerTest, ToolError>>;
}

/** mcp.tools@1: lists and calls the tools of the configured servers (docs/10, level 1). */
export interface McpToolsAdapter {
	list(signal: AbortSignal): Promise<Result<McpToolInfo[], ToolError>>;
	call(
		input: McpCallInput,
		ctx: ToolContext,
	): Promise<Result<McpCallOutput, ToolError>>;
}
