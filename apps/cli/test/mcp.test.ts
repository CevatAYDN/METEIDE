import { join } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import { mcpCommand } from "../src/application/commands.js";
import { createApp } from "../src/infrastructure/app.js";
import { lockHolder, runLockFile } from "../src/infrastructure/run-lock.js";
import { main } from "../src/main.js";
import {
	memorySecrets,
	recordingIo,
	scriptedProvider,
	silent,
	tempRepo,
} from "./helpers.js";

// `mete mcp` through every real module; the host is an SDK client on an in-memory transport.

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
	await close?.();
	close = undefined;
});

const ended = () => {
	let end = () => {};
	const closed = new Promise<void>((r) => {
		end = r;
	});
	return { closed, end };
};

describe("mete mcp", () => {
	it("serves the four tools until the host leaves, never writing to stdout", async () => {
		const repo = await tempRepo({ "a.txt": "a\n" });
		const [mine, theirs] = InMemoryTransport.createLinkedPair();
		const app = await createApp({
			workspaceDir: repo.workspaceDir,
			globalDir: repo.globalDir,
			templatesDir: join(repo.globalDir, "no-templates"),
			logger: silent,
			secrets: memorySecrets(),
			providers: [scriptedProvider({ script: [] })],
			serve: mine,
		});
		if (!app.ok) throw new Error(JSON.stringify(app.error));
		close = async () => {
			await app.value.stop();
			await repo.close();
		};
		const t = recordingIo();
		const host = ended();
		const serving = mcpCommand(app.value, t.io, repo.workspaceDir, host.closed);
		const client = new Client({ name: "host", version: "0" });
		await client.connect(theirs);
		const { tools } = await client.listTools();
		expect(tools.map((x) => x.name)).toHaveLength(4);
		const status = await client.callTool({
			name: "mete_task_status",
			arguments: { runId: "nope" },
		});
		expect(status.isError).toBe(true);
		await client.close();
		host.end();
		expect(await serving).toBe(0);
		expect(t.out).toEqual([]);
		expect(t.err).toEqual([`serving METE over MCP for ${repo.workspaceDir}`]);
	});

	it("refuses without an engine, on the folder it was given, and frees the lock", async () => {
		const repo = await tempRepo({ "a.txt": "a\n" });
		close = repo.close;
		const t = recordingIo();
		const [mine] = InMemoryTransport.createLinkedPair();
		const env = {
			cwd: join(repo.workspaceDir, ".."),
			globalDir: repo.globalDir,
			logger: silent,
			secrets: memorySecrets(),
			serve: () => ({ transport: mine, closed: new Promise<void>(() => {}) }),
		};
		expect(await main(["mcp", "repo"], t.io, env)).toBe(1);
		expect(t.out).toEqual([]);
		expect(t.err).toContain("core-engine is not active.");
		expect(await lockHolder(runLockFile(repo.workspaceDir))).toBeUndefined();
	});
});
