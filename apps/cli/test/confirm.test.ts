import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { McpToolsAdapter } from "@mete/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { terminalConfirm } from "../src/application/confirm.js";
import { createApp } from "../src/infrastructure/app.js";
import {
	memorySecrets,
	recordingIo,
	scriptedProvider,
	silent,
	tempRepo,
} from "./helpers.js";

const signal = new AbortController().signal;
const signalOf = () => signal;
const ask = (answers?: (string | undefined)[]) => {
	const t = recordingIo("", answers);
	return { t, confirm: terminalConfirm(t.io) };
};

describe("terminal confirmation", () => {
	it("is a yes only for a clear yes", async () => {
		const yes = ask(["Y"]);
		expect(await yes.confirm("fixture", "Allow it?", signalOf())).toBe(true);
		expect(yes.t.prompts).toEqual(["Allow it? (y/n): "]);
		expect(await ask(["no"]).confirm("s", "q", signalOf())).toBe(false);
	});

	it("asks once more after an unclear answer, then says no; end of input is no", async () => {
		const unclear = ask(["maybe", "perhaps"]);
		expect(await unclear.confirm("s", "q", signalOf())).toBe(false);
		expect(unclear.t.prompts).toHaveLength(2);
		const again = ask(["maybe", "yes"]);
		expect(await again.confirm("s", "q", signalOf())).toBe(true);
		expect(await ask([undefined]).confirm("s", "q", signalOf())).toBe(false);
	});

	it("is no without a terminal, and prints nothing", async () => {
		const none = ask();
		expect(await none.confirm("s", "q", signalOf())).toBe(false);
		expect(none.t.out).toEqual([]);
		expect(none.t.err).toEqual([]);
	});
});

const FIXTURE = fileURLToPath(
	new URL("../../../packages/mcp/test/fixtures/server.mjs", import.meta.url),
);

let close = async () => {};
afterEach(() => close());

describe("sampling through the app", () => {
	it("asks the user in the terminal, then answers from the gateway's model", async () => {
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
		// A raw MCP call is allowed at autonomy 3, but the model call it asks for stays at level 2: ask.
		const policy = "autonomy: 3\noverrides:\n  llm.chat@2: 2\n";
		await writeFile(join(repo.workspaceDir, ".mete", "policy.yaml"), policy);
		const t = recordingIo("", ["y"]);
		const app = await createApp({
			workspaceDir: repo.workspaceDir,
			globalDir: repo.globalDir,
			logger: silent,
			secrets: memorySecrets(),
			providers: [
				scriptedProvider({
					script: [
						[
							{ type: "text", text: "hello" },
							{
								type: "finish",
								reason: "stop",
								usage: { prompt: 1, completion: 1 },
							},
						],
					],
				}),
			],
			confirm: terminalConfirm(t.io),
		});
		if (!app.ok) throw new Error(JSON.stringify(app.error));
		close = async () => {
			await app.value.stop();
			await repo.close();
		};
		const r = app.value.registry.resolve<McpToolsAdapter>("mcp.tools@1");
		if (!r.ok) throw new Error("mcp.tools@1 is not active");
		const run = "7f3c2a1e-4b5d-4c6e-8f9a-0b1c2d3e4f5a";
		const out = await r.value[0].impl.call(
			{ server: "fixture", tool: "summon" },
			{ signal, runId: run },
		);
		const block = out.ok ? out.value.content[0] : undefined;
		expect(block?.type === "text" && block.text).toMatch(
			/^fake\/coder-1: hello$/,
		);
		expect(t.prompts).toHaveLength(1);
		expect(t.prompts[0]).toMatch(/^MCP server fixture wants to ask a model/);
	});
});
