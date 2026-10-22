import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
	McpServer,
	McpToolsAdapter,
	PolicyVerdict,
} from "@mete/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openTransport } from "../src/infrastructure/transport.js";
import { createMcpClientModule } from "../src/module.js";
import { moduleContext } from "./helpers/context.js";

const FIXTURE = fileURLToPath(
	new URL("./fixtures/server.mjs", import.meta.url),
);
const signal = new AbortController().signal;
const fixture = {
	id: "fixture",
	transport: "stdio",
	runtime: "node",
	command: process.execPath,
	args: [FIXTURE],
};

const start = async (
	verdict: PolicyVerdict["verdict"],
	servers: unknown[],
	workspaceDir: string,
) => {
	const module = createMcpClientModule({ workspaceDir, builtInServers: [] });
	const { ctx, registry } = moduleContext(verdict, { mcp: { servers } });
	const activated = await module.activate(ctx);
	const r = registry.resolve<McpToolsAdapter>("mcp.tools@1");
	return { module, activated, tools: r.ok ? r.value[0].impl : undefined };
};

describe("mcp-client over stdio", () => {
	let dir = "";
	let s: Awaited<ReturnType<typeof start>>;
	beforeAll(async () => {
		dir = await mkdtemp(join(tmpdir(), "mete-mcp-"));
		s = await start("allow", [fixture], dir);
	});
	afterAll(async () => {
		await s.module.deactivate();
		await rm(dir, { recursive: true, force: true });
	});

	it("lists the server's tools under its id", async () => {
		const r = await s.tools?.list(signal);
		expect(r?.ok && r.value.map((t) => `${t.server}/${t.name}`)).toEqual([
			"fixture/echo",
			"fixture/fail",
			"fixture/pixel",
			"fixture/web_search_advanced_exa",
		]);
	});

	it("returns text, passes the server's error flag and saves images", async () => {
		const call = (tool: string, args = {}) =>
			s.tools?.call({ server: "fixture", tool, args }, { signal });
		expect(await call("echo", { text: "hi" })).toEqual({
			ok: true,
			value: { content: [{ type: "text", text: "hi" }], isError: false },
		});
		const failed = await call("fail");
		expect(failed?.ok && failed.value.isError).toBe(true);
		const pixel = await call("pixel");
		const image = pixel?.ok ? pixel.value.content[0] : undefined;
		expect(image?.type === "image" && image.mediaType).toBe("image/png");
		expect(image?.type === "image" && existsSync(join(dir, image.path))).toBe(
			true,
		);
	});

	it("names an unknown server or tool", async () => {
		const tool = await s.tools?.call(
			{ server: "fixture", tool: "nope" },
			{ signal },
		);
		expect(tool?.ok === false && tool.error.code).toBe("not_found");
		const server = await s.tools?.call(
			{ server: "other", tool: "echo" },
			{ signal },
		);
		expect(server?.ok === false && server.error.message).toMatch(
			/no MCP server other/,
		);
	});
});

describe("mcp-client refusals", () => {
	it("asks the policy before it starts the server", async () => {
		const s = await start("ask", [fixture], tmpdir());
		const r = await s.tools?.call(
			{ server: "fixture", tool: "echo" },
			{ signal },
		);
		expect(r).toEqual({
			ok: false,
			error: {
				code: "approval_required",
				rule: "kit:ask",
				message: "mcp.call fixture/echo: ask (kit:ask)",
			},
		});
		await s.module.deactivate();
	});

	it("reports a command that cannot start and a bad mcp.yaml", async () => {
		const missing = {
			...fixture,
			id: "missing",
			command: "mete-no-such-command",
		};
		const s = await start("allow", [missing], tmpdir());
		const r = await s.tools?.call(
			{ server: "missing", tool: "echo" },
			{ signal },
		);
		expect(r?.ok === false && r.error).toMatchObject({
			code: "io",
			message: expect.stringMatching(/^MCP server missing: /),
		});
		await s.module.deactivate();
		const bad = await start(
			"allow",
			[{ id: "Bad Id", transport: "stdio" }],
			tmpdir(),
		);
		expect(bad.activated.ok === false && bad.activated.error.message).toMatch(
			/^settings\.yaml /,
		);
	});
});

describe("mcp-client runtimes", () => {
	it("puts the runtime's folder first on the server's PATH and names a missing one", async () => {
		const opened: McpServer[] = [];
		const module = createMcpClientModule({
			workspaceDir: tmpdir(),
			builtInServers: [],
			globalDir: tmpdir(),
			runtimeSystem: {
				which: (command) => (command === "node" ? "/rt" : undefined),
				version: async () => "v22.0.0",
				extract: async () => ({ ok: false, error: "unused" }),
			},
			open: (server, fetchFn) => {
				opened.push(server);
				return openTransport(server, fetchFn);
			},
		});
		const docker = { ...fixture, id: "boxed", runtime: "container" };
		const { ctx, registry } = moduleContext("allow", {
			mcp: { servers: [fixture, docker] },
		});
		await module.activate(ctx);
		const r = registry.resolve<McpToolsAdapter>("mcp.tools@1");
		const tools = r.ok ? r.value[0].impl : undefined;
		const echo = await tools?.call(
			{ server: "fixture", tool: "echo", args: { text: "hi" } },
			{ signal },
		);
		expect(echo?.ok).toBe(true);
		const path = opened[0]?.transport === "stdio" ? opened[0].env?.PATH : "";
		expect(path?.startsWith(`/rt${delimiter}`)).toBe(true);
		const boxed = await tools?.call(
			{ server: "boxed", tool: "echo" },
			{ signal },
		);
		expect(boxed?.ok === false && boxed.error).toEqual({
			code: "not_found",
			message: "MCP server boxed: no docker or podman on PATH",
		});
		expect(registry.resolve("runtime.ensure@1").ok).toBe(true);
		await module.deactivate();
	});

	it("downloads a binary server's pinned file and puts its folder first on PATH", async () => {
		const globalDir = await mkdtemp(join(tmpdir(), "mete-rt-"));
		const bytes = Buffer.from("tool");
		const sha256 = createHash("sha256").update(bytes).digest("hex");
		const opened: McpServer[] = [];
		const module = createMcpClientModule({
			workspaceDir: globalDir,
			builtInServers: [],
			globalDir,
			fetch: async () => new Response(bytes),
			open: (server, fetchFn) => {
				opened.push(server);
				return openTransport(server, fetchFn);
			},
		});
		const url = "https://a.example/tool";
		const tool = { ...fixture, id: "tool", runtime: "binary", url, sha256 };
		const { ctx, registry } = moduleContext("allow", {
			mcp: { servers: [tool] },
		});
		await module.activate(ctx);
		const r = registry.resolve<McpToolsAdapter>("mcp.tools@1");
		const echo = await (r.ok ? r.value[0].impl : undefined)?.call(
			{ server: "tool", tool: "echo", args: { text: "hi" } },
			{ signal },
		);
		expect(echo?.ok).toBe(true);
		const bin = join(globalDir, "runtimes", "bin", sha256);
		const path = opened[0]?.transport === "stdio" ? opened[0].env?.PATH : "";
		expect(path?.startsWith(`${bin}${delimiter}`)).toBe(true);
		expect(existsSync(join(bin, "tool"))).toBe(true);
		await module.deactivate();
		await rm(globalDir, { recursive: true, force: true });
	});
});
