import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { McpStatusAdapter, McpToolsAdapter } from "@mete/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMcpClientModule } from "../src/module.js";
import { moduleContext } from "./helpers/context.js";

const FIXTURE = fileURLToPath(
	new URL("./fixtures/server.mjs", import.meta.url),
);
const signal = new AbortController().signal;
const stdio = (id: string, args: string[]) => ({
	id,
	transport: "stdio",
	runtime: "node",
	command: process.execPath,
	args,
});

describe("mcp.status@1 (ADR-164)", () => {
	let dir = "";
	let module: ReturnType<typeof createMcpClientModule>;
	let status: McpStatusAdapter | undefined;
	let tools: McpToolsAdapter | undefined;
	beforeAll(async () => {
		dir = await mkdtemp(join(tmpdir(), "mete-mcp-status-"));
		module = createMcpClientModule({ workspaceDir: dir, builtInServers: [] });
		const servers = [
			stdio("fixture", [FIXTURE]),
			stdio("broken", ["-e", "process.exit(3)"]),
		];
		const { ctx, registry } = moduleContext("allow", { mcp: { servers } });
		await module.activate(ctx);
		const s = registry.resolve<McpStatusAdapter>("mcp.status@1");
		status = s.ok ? s.value[0].impl : undefined;
		const t = registry.resolve<McpToolsAdapter>("mcp.tools@1");
		tools = t.ok ? t.value[0].impl : undefined;
	});
	afterAll(async () => {
		await module.deactivate();
		await rm(dir, { recursive: true, force: true });
	});

	it("names the tools a server lists, in its order, as mcp.tools@1 lists them", async () => {
		const r = await status?.test("fixture", signal);
		if (!r?.ok) throw new Error(JSON.stringify(r));
		const listed = await tools?.list(signal);
		expect(r.value.tools).toEqual(
			listed?.ok && listed.value.map((t) => t.name),
		);
		expect(r.value.tools[0]).toBe("echo");
		expect(r.value.ms).toBeGreaterThanOrEqual(0);
	});

	it("says why a server does not connect", async () => {
		const r = await status?.test("broken", signal);
		expect(r?.ok).toBe(false);
		expect(!r?.ok && r?.error.code).toBe("io");
		expect(!r?.ok && r?.error.message).toMatch(/^MCP server broken: /);
	});

	it("answers not_found for a server METE did not load", async () => {
		const r = await status?.test("added-later", signal);
		expect(!r?.ok && r?.error.code).toBe("not_found");
	});
});
