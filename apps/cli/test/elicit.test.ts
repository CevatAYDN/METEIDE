import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { McpToolsAdapter } from "@mete/contracts";
import type { ElicitRequestFormParams } from "@mete/mcp";
import { afterEach, describe, expect, it } from "vitest";
import { terminalElicit } from "../src/application/elicit.js";
import { createApp } from "../src/infrastructure/app.js";
import { memorySecrets, recordingIo, silent, tempRepo } from "./helpers.js";

const signal = new AbortController().signal;

const form = (
	properties: Record<string, unknown>,
	required: string[] = [],
	message = "Who are you?",
) =>
	({
		message,
		requestedSchema: { type: "object", properties, required },
	}) as ElicitRequestFormParams;

const person = form(
	{
		name: { type: "string", description: "your name" },
		age: { type: "integer" },
		admin: { type: "boolean" },
		color: { type: "string", enum: ["red", "blue"] },
	},
	["name", "admin"],
);

describe("terminal elicitation", () => {
	it("names the server, asks one field at a time and returns the typed values", async () => {
		const t = recordingIo("", ["Ada", "", "yes", "blue"]);
		const r = await terminalElicit(t.io)("fixture", person, signal);
		expect(r).toEqual({
			action: "accept",
			content: { name: "Ada", admin: true, color: "blue" },
		});
		expect(t.out).toEqual(["MCP server fixture asks:", "  Who are you?"]);
		expect(t.prompts).toEqual([
			"name - your name (string): ",
			"age (integer, optional): ",
			"admin (y/n): ",
			"color (red / blue, optional): ",
		]);
	});

	it("prints what a server wrote as plain text, without control characters", async () => {
		const t = recordingIo("", []);
		const asking = form({}, [], "pay \u001b[31mnow\u001b[0m\u0007");
		await terminalElicit(t.io)("fixture", asking, signal);
		expect(t.out[1]).toBe("  pay  [31mnow [0m");
	});

	it("asks a bad answer once more, then declines; end of input cancels", async () => {
		const bad = recordingIo("", ["x", "y"]);
		const ask = form({ age: { type: "integer" } }, ["age"]);
		expect(await terminalElicit(bad.io)("s", ask, signal)).toEqual({
			action: "decline",
		});
		expect(bad.prompts).toHaveLength(2);
		const gone = recordingIo("", [undefined]);
		expect(await terminalElicit(gone.io)("s", ask, signal)).toEqual({
			action: "cancel",
		});
	});

	it("declines without printing anything when there is no terminal to ask on", async () => {
		const t = recordingIo();
		expect(await terminalElicit(t.io)("fixture", person, signal)).toEqual({
			action: "decline",
		});
		expect(t.out).toEqual([]);
		expect(t.err).toEqual([]);
	});

	it("declines a form with a multiple-choice list and stops when the server cancels", async () => {
		const t = recordingIo("", ["x"]);
		const many = form({ tags: { type: "array", items: { type: "string" } } });
		expect(await terminalElicit(t.io)("s", many, signal)).toEqual({
			action: "decline",
		});
		const stop = new AbortController();
		stop.abort();
		expect(
			await terminalElicit(t.io)(
				"s",
				form({ a: { type: "string" } }),
				stop.signal,
			),
		).toEqual({ action: "cancel" });
	});
});

const FIXTURE = fileURLToPath(
	new URL("../../../packages/mcp/test/fixtures/server.mjs", import.meta.url),
);

let close = async () => {};
afterEach(() => close());

describe("elicitation through the app", () => {
	it("lets an MCP server ask the user in the terminal", async () => {
		const mcp = `servers:
  - id: fixture
    transport: stdio
    runtime: node
    command: ${JSON.stringify(process.execPath)}
    args: [${JSON.stringify(FIXTURE)}]
    permissions: []
`;
		const repo = await tempRepo({ "a.txt": "a\n" });
		await mkdir(join(repo.workspaceDir, ".mete"));
		await writeFile(join(repo.workspaceDir, ".mete", "mcp.yaml"), mcp);
		// A raw MCP call is asked at autonomy 2 and allowed at 3 (SECURITY.md).
		await writeFile(
			join(repo.workspaceDir, ".mete", "policy.yaml"),
			"autonomy: 3\n",
		);
		const t = recordingIo("", ["Grace"]);
		const app = await createApp({
			workspaceDir: repo.workspaceDir,
			globalDir: repo.globalDir,
			logger: silent,
			secrets: memorySecrets(),
			providers: [],
			elicit: terminalElicit(t.io),
		});
		if (!app.ok) throw new Error(JSON.stringify(app.error));
		close = async () => {
			await app.value.stop();
			await repo.close();
		};
		const r = app.value.registry.resolve<McpToolsAdapter>("mcp.tools@1");
		if (!r.ok) throw new Error("mcp.tools@1 is not active");
		const out = await r.value[0].impl.call(
			{ server: "fixture", tool: "ask" },
			{ signal },
		);
		const block = out.ok ? out.value.content[0] : undefined;
		expect(block?.type === "text" && block.text).toBe("Grace");
		expect(t.out).toEqual(["MCP server fixture asks:", "  Who are you?"]);
	});
});
