import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { err, type McpServer, type McpToolsAdapter, ok } from "@mete/contracts";
import { describe, expect, it, vi } from "vitest";
import { mappedAdapter } from "../src/application/mapped.js";
import { mcpTools } from "../src/application/mcp-tools.js";
import type { Sessions } from "../src/application/sessions.js";
import { TOOL_DESCRIPTION_MAX } from "../src/defaults.js";
import { openTransport } from "../src/infrastructure/transport.js";

const FIXTURE = fileURLToPath(
	new URL("./fixtures/server.mjs", import.meta.url),
);
const signal = new AbortController().signal;
const server: McpServer = {
	id: "fixture",
	transport: "stdio",
	runtime: "node",
	command: process.execPath,
	args: [FIXTURE],
	permissions: [],
};

const open = async (platform: NodeJS.Platform) => {
	const killTree = vi.fn<(pid: number) => void>();
	const opened = await openTransport(server, { platform, killTree });
	await opened.transport.start();
	const pid = (opened.transport as { pid?: number | null }).pid;
	await opened.transport.close();
	return { killTree, pid };
};

describe("stdio transport close", () => {
	it("ends the whole process tree on Windows", async () => {
		const { killTree, pid } = await open("win32");
		expect(typeof pid).toBe("number");
		expect(killTree).toHaveBeenCalledWith(pid);
	});

	it("leaves the SDK's close alone elsewhere", async () => {
		const { killTree } = await open("linux");
		expect(killTree).not.toHaveBeenCalled();
	});
});

const logger = { error() {}, warn() {}, info() {}, debug() {} };
const client = { callTool: vi.fn() };
const sessions = (tools: { name: string; description?: string }[]) =>
	({
		servers: [server],
		get: async () => ok({ client, tools }),
		callOptions: () => ({}),
		calls: { during: (_s: string, _c: unknown, f: () => unknown) => f() },
	}) as unknown as Sessions;

describe("mcp.tools@1 listing", () => {
	it("cuts a server's tool description to its limit", async () => {
		const long = "x".repeat(TOOL_DESCRIPTION_MAX + 50);
		const tools: McpToolsAdapter = mcpTools({
			adapterId: "mcp-client",
			workspaceDir: tmpdir(),
			sessions: sessions([{ name: "a", description: long }, { name: "b" }]),
			policy: () => undefined,
			logger,
		});
		const r = await tools.list(signal);
		expect(r.ok && r.value.map((t) => t.description.length)).toEqual([
			TOOL_DESCRIPTION_MAX,
			0,
		]);
	});
});

describe("mapped args", () => {
	it("refuses arguments that do not render to an object", async () => {
		// Args are typed as a record, but `{ each, as }` or a hand-built entry can render otherwise.
		const entry = { tool: "t", action: "net.fetch", args: "{{input.query}}" };
		const mapping = { metadata: { id: "m" }, server: "fixture" };
		const adapter = mappedAdapter(
			{
				workspaceDir: tmpdir(),
				sessions: sessions([]),
				policy: () => ({
					check: () => err({ code: "audit_failed", message: "no" }),
				}),
			},
			{ mapping: mapping as never, ref: "web.search@1", entry: entry as never },
		);
		expect(await adapter.run({ query: "q" }, { signal })).toEqual({
			ok: false,
			error: {
				code: "bad_input",
				message: "mapping m for web.search@1: args must render to an object",
			},
		});
		expect(client.callTool).not.toHaveBeenCalled();
	});
});
