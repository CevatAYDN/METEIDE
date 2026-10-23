import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type {
	McpServer,
	McpToolsAdapter,
	MeteEvent,
	PolicyVerdict,
} from "@mete/contracts";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { openTransport } from "../src/infrastructure/transport.js";
import { createMcpClientModule, type McpClientOptions } from "../src/module.js";
import { moduleContext } from "./helpers/context.js";

const FIXTURE = fileURLToPath(
	new URL("./fixtures/server.mjs", import.meta.url),
);
const signal = new AbortController().signal;
const WS = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const RUN = "7f3c2a1e-4b5d-4c6e-8f9a-0b1c2d3e4f5a";
const AGENT = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
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
	more: Partial<McpClientOptions> = {},
) => {
	const module = createMcpClientModule({
		workspaceDir,
		builtInServers: [],
		...more,
	});
	const { ctx, registry, infos } = moduleContext(verdict, { mcp: { servers } });
	const activated = await module.activate(ctx);
	const r = registry.resolve<McpToolsAdapter>("mcp.tools@1");
	return {
		module,
		activated,
		infos,
		ctx,
		tools: r.ok ? r.value[0].impl : undefined,
	};
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
			"fixture/where",
			"fixture/slow",
			"fixture/cancelled",
			"fixture/grow",
			"fixture/summon",
			"fixture/ask",
			"fixture/steps",
			"fixture/web_search_advanced_exa",
		]);
	});

	it("starts the server in the workspace folder and lists it as its only root", async () => {
		const r = await s.tools?.call(
			{ server: "fixture", tool: "where" },
			{ signal },
		);
		const block = r?.ok ? r.value.content[0] : undefined;
		const seen = JSON.parse(block?.type === "text" ? block.text : "{}");
		expect(realpathSync(seen.cwd)).toBe(realpathSync(dir));
		expect(seen.roots).toEqual([
			{ uri: pathToFileURL(dir).href, name: "workspace" },
		]);
	});

	it("returns text, passes the server's error flag and saves images", async () => {
		const call = (tool: string, args = {}) =>
			s.tools?.call(
				{ server: "fixture", tool, args },
				{ signal, runId: "run-1" },
			);
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
		// One manifest line per saved file says which call made it (docs/10, content types).
		const saved = join(dir, image?.type === "image" ? image.path : "");
		const bytes = await readFile(saved);
		const lines = (
			await readFile(join(dir, ".mete", "assets", "manifest.jsonl"), "utf8")
		)
			.trim()
			.split("\n");
		expect(JSON.parse(lines.at(-1) ?? "")).toEqual({
			path: image?.type === "image" ? image.path : "",
			mediaType: "image/png",
			bytes: bytes.length,
			sha256: createHash("sha256").update(bytes).digest("hex"),
			server: "fixture",
			tool: "pixel",
			runId: "run-1",
			at: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
		});
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

describe("mcp-client notifications", () => {
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
	const call = (tool: string, signal_ = signal) =>
		s.tools?.call({ server: "fixture", tool }, { signal: signal_ });
	const text = (r: Awaited<ReturnType<typeof call>>) => {
		const block = r?.ok ? r.value.content[0] : undefined;
		return block?.type === "text" ? block.text : "";
	};

	it("tells the server a call is cancelled when the run's signal aborts, and the session keeps working", async () => {
		await call("cancelled"); // starts the server, so the abort lands on the call and not on the connect
		const stop = new AbortController();
		const slow = call("slow", stop.signal);
		setTimeout(() => stop.abort(), 100);
		const started = Date.now();
		const r = await slow;
		expect(r?.ok === false && r.error.code).toBe("io");
		expect(Date.now() - started).toBeLessThan(2000);
		await vi.waitFor(
			async () => expect(text(await call("cancelled"))).toBe("1"),
			{ timeout: 5000 },
		);
	});

	it("logs each progress step of a call", async () => {
		await call("steps");
		const steps = s.infos.filter((i) => i.msg === "MCP tool progress");
		expect(steps).toEqual([
			{
				moduleId: "mcp-client",
				server: "fixture",
				tool: "steps",
				progress: 1,
				total: 2,
				message: "step 1",
				msg: "MCP tool progress",
			},
			{
				moduleId: "mcp-client",
				server: "fixture",
				tool: "steps",
				progress: 2,
				total: 2,
				message: "step 2",
				msg: "MCP tool progress",
			},
		]);
	});

	it("publishes the first progress step of a call in a run, without the server's message (ADR-067)", async () => {
		const seen: MeteEvent[] = [];
		const p = await start("allow", [fixture], dir, { workspaceId: WS });
		p.ctx.events.subscribe("agent.*", (e) => void seen.push(e));
		await p.tools?.call({ server: "fixture", tool: "steps" }, { signal });
		expect(seen).toEqual([]);
		await p.tools?.call(
			{ server: "fixture", tool: "steps" },
			{ signal, runId: RUN, agentId: AGENT },
		);
		await p.module.deactivate();
		// Both steps come in the same second, so the second one stays in the log.
		expect(seen).toMatchObject([
			{
				type: "agent.tool.progress",
				workspaceId: WS,
				runId: RUN,
				agentId: AGENT,
				source: "mcp-client",
				payload: { capability: "mcp.tools@1", progress: 1, total: 2 },
			},
		]);
		expect(seen[0]?.payload).not.toHaveProperty("message");
	});

	it("lists a tool the server adds after it connected", async () => {
		const names = async () => {
			const r = await s.tools?.list(signal);
			return r?.ok ? r.value.map((t) => t.name) : [];
		};
		expect(await names()).not.toContain("grown");
		await call("grow");
		await vi.waitFor(async () => expect(await names()).toContain("grown"), {
			timeout: 5000,
		});
		expect(text(await call("grown"))).toBe("grown");
		expect(s.infos.some((i) => i.msg === "MCP server tool list changed")).toBe(
			true,
		);
	});
});

describe("mcp-client elicitation", () => {
	const ask = (s: Awaited<ReturnType<typeof start>>) =>
		s.tools?.call({ server: "fixture", tool: "ask" }, { signal });
	const textOf = (r: Awaited<ReturnType<typeof ask>>) => {
		const block = r?.ok ? r.value.content[0] : undefined;
		return block?.type === "text" ? block.text : "";
	};

	it("hands a server's form request to the host and returns what the user answered", async () => {
		const asked: { server: string; message: string }[] = [];
		const s = await start("allow", [fixture], tmpdir(), {
			elicit: async (server, params) => {
				asked.push({ server, message: params.message });
				return { action: "accept", content: { name: "Ada" } };
			},
		});
		expect(textOf(await ask(s))).toBe("Ada");
		expect(asked).toEqual([{ server: "fixture", message: "Who are you?" }]);
		await s.module.deactivate();
	});

	it("passes a decline on, and without a host the server's request fails", async () => {
		const declining = await start("allow", [fixture], tmpdir(), {
			elicit: async () => ({ action: "decline" }),
		});
		expect(textOf(await ask(declining))).toBe("decline");
		await declining.module.deactivate();
		const none = await start("allow", [fixture], tmpdir());
		const r = await ask(none);
		expect(r?.ok && r.value.isError).toBe(true);
		expect(textOf(r)).toMatch(/elicitation/i);
		await none.module.deactivate();
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
				which: (command) =>
					command === "node" || command === "npx" ? "/rt" : undefined,
				version: async () => "v22.0.0",
				extract: async () => ({ ok: false, error: "unused" }),
			},
			open: (server, opts) => {
				opened.push(server);
				return openTransport(server, opts);
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
			open: (server, opts) => {
				opened.push(server);
				return openTransport(server, opts);
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
