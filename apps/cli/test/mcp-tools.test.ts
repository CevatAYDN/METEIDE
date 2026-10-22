import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ChatChunk, ChatRequest } from "@mete/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { runCommand } from "../src/application/commands.js";
import { createApp } from "../src/infrastructure/app.js";
import { runHistory } from "../src/infrastructure/history.js";
import {
	memorySecrets,
	recordingIo,
	scriptedProvider,
	silent,
	tempRepo,
} from "./helpers.js";

// Raw MCP tools through a team role (docs/10, MCP client; docs/08): a role that lists mcp.tools@1 gets
// one model tool per server tool, policy asks mcp.call first, and the result reaches the model as
// external content. The server is the stdio fixture of the mcp package; the models are scripted.

const FIXTURE = fileURLToPath(
	new URL("../../../packages/mcp/test/fixtures/server.mjs", import.meta.url),
);

const MCP_YAML = `servers:
  - id: fixture
    transport: stdio
    runtime: node
    command: ${JSON.stringify(process.execPath)}
    args: [${JSON.stringify(FIXTURE)}]
    permissions: []
`;

const TEAM = `apiVersion: mete/v1
kind: TeamTemplate
metadata: { id: mcp-check, name: MCP check, version: 1.0.0 }
pattern: single
roles:
  - { id: checker, name: Checker, goal: Use the echo tool, tier: reasoning, needs: [tool_calling], capabilities: [mcp.tools@1] }
tasks:
  - { id: check, role: checker, title: Echo hi }
`;

const finish = (reason: "stop" | "tool-calls"): ChatChunk => ({
	type: "finish",
	reason,
	usage: { prompt: 10, completion: 5 },
});
const script: ChatChunk[][] = [
	[
		{
			type: "tool-call",
			id: "c1",
			name: "mcp_fixture_echo",
			args: { text: "hi" },
		},
		finish("tool-calls"),
	],
	[{ type: "text", text: "echoed" }, finish("stop")],
];

// Every URL is a 404, so the built-in Exa server fails to connect and is skipped, with no network.
const offline: typeof fetch = async () => new Response("", { status: 404 });

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
	await close?.();
	close = undefined;
});

const start = async (autonomy: number) => {
	const repo = await tempRepo({ "README.md": "# notes\n" });
	const mete = join(repo.workspaceDir, ".mete");
	await mkdir(join(mete, "teams"), { recursive: true });
	await writeFile(join(mete, "mcp.yaml"), MCP_YAML);
	await writeFile(join(mete, "teams", "mcp-check.yaml"), TEAM);
	await writeFile(join(mete, "policy.yaml"), `autonomy: ${autonomy}\n`);
	const seen: ChatRequest[] = [];
	const app = await createApp({
		workspaceDir: repo.workspaceDir,
		globalDir: repo.globalDir,
		logger: silent,
		secrets: memorySecrets(),
		providers: [scriptedProvider({ script, seen })],
		fetch: offline,
	});
	if (!app.ok) throw new Error(JSON.stringify(app.error));
	close = async () => {
		await app.value.stop();
		await repo.close();
	};
	const t = recordingIo();
	const code = await runCommand(app.value, t.io, {
		goal: "echo hi",
		templateId: "mcp-check",
	});
	const runId = /^run (\S+) started$/.exec(t.out[0] ?? "")?.[1] ?? "";
	const events = runHistory(app.value.registry, runId)?.events ?? [];
	return { code, seen, events, out: t.out, err: t.err };
};

describe("raw MCP tools through a team role", () => {
	it("offers one model tool per server tool and hands the result over as external content", async () => {
		const r = await start(3);
		expect(r.code).toBe(0);
		// Level 3 runs without verify gates and worktrees, and the run says so once.
		expect(r.err.filter((l) => l.startsWith("autonomy 3:"))).toEqual([
			"autonomy 3: verify gates and worktrees are not available yet (SECURITY.md); the run goes on with checkpoints only",
		]);
		const offered = r.seen[0]?.tools?.map((t) => t.name) ?? [];
		expect(offered).toContain("mcp_fixture_echo");
		const called = r.events.flatMap((e) =>
			e.type === "agent.tool.called" ? [e.payload] : [],
		);
		expect(called).toEqual([
			{ capability: "mcp.tools@1", adapterId: "mcp-client" },
		]);
		const done = r.events.flatMap((e) =>
			e.type === "agent.tool.completed" ? [e.payload] : [],
		);
		expect(done).toMatchObject([{ capability: "mcp.tools@1", ok: true }]);
		const result = r.seen[1]?.messages.find((m) => m.role === "tool");
		expect(result?.content).toMatch(/^External content from the web follows\./);
		expect(result?.content).toContain('"text":"hi"');
	});

	it("asks before the call at autonomy 2: the run pauses and the model sees no result", async () => {
		const r = await start(2);
		expect(r.code).toBe(2);
		expect(r.err.some((l) => l.startsWith("autonomy 3:"))).toBe(false);
		expect(r.events.map((e) => e.type)).toContain("run.paused");
		const result = r.seen[1]?.messages.find((m) => m.role === "tool");
		expect(result).toBeUndefined();
		const done = r.events.flatMap((e) =>
			e.type === "agent.tool.completed" ? [e.payload] : [],
		);
		expect(done).toMatchObject([
			{
				capability: "mcp.tools@1",
				ok: false,
				error: { code: "approval_required" },
			},
		]);
	});
});
