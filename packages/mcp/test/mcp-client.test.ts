import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { McpToolsAdapter, PolicyVerdict } from "@mete/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
	const module = createMcpClientModule({ workspaceDir });
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
