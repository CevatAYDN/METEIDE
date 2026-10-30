import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { DAEMON_METHODS, DaemonMcpTestResultSchema } from "@mete/contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
	createMessageConnection,
	ResponseError,
	StreamMessageReader,
	StreamMessageWriter,
} from "vscode-jsonrpc/node";
import { daemonCommand } from "../src/application/daemon.js";
import { createApp } from "../src/infrastructure/app.js";
import { memorySecrets, recordingIo, silent, tempRepo } from "./helpers.js";

// mete/mcp.test (ADR-164): the Settings card's Test, through mcp.status@1, with no engine and no model.

const FIXTURE = join(
	process.cwd(),
	"..",
	"..",
	"packages",
	"mcp",
	"test",
	"fixtures",
	"server.mjs",
);
// Built at runtime so no secret-shaped literal sits in the repository.
const TOKEN = `ghp_${"A1b2C3d4E5".repeat(3)}aBcDeF`;
const MCP = `servers:
  - id: demo
    transport: stdio
    runtime: node
    command: ${JSON.stringify(process.execPath)}
    args: [${JSON.stringify(FIXTURE)}]
  - id: broken
    transport: stdio
    runtime: node
    command: ${JSON.stringify(process.execPath)}
    args: ["-e", "console.error('refused ${TOKEN}'); process.exit(3)"]
`;

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
	await close?.();
	close = undefined;
});

const served = async () => {
	const repo = await tempRepo({ "a.txt": "a\n" });
	await mkdir(join(repo.workspaceDir, ".mete"), { recursive: true });
	await writeFile(join(repo.workspaceDir, ".mete", "mcp.yaml"), MCP);
	const app = await createApp({
		workspaceDir: repo.workspaceDir,
		globalDir: repo.globalDir,
		logger: silent,
		secrets: memorySecrets(),
	});
	if (!app.ok) throw new Error(JSON.stringify(app.error));
	const [toDaemon, toClient] = [new PassThrough(), new PassThrough()];
	const serving = daemonCommand(
		app.value,
		recordingIo().io,
		repo.workspaceDir,
		{ input: toDaemon, output: toClient },
	);
	const c = createMessageConnection(
		new StreamMessageReader(toClient),
		new StreamMessageWriter(toDaemon),
	);
	c.listen();
	close = async () => {
		toDaemon.end();
		await serving;
		c.dispose();
		await app.value.stop();
		await repo.close();
	};
	return c;
};

describe("mete/mcp.test", { timeout: 30_000 }, () => {
	it("names a server's tools, says why another fails with its secrets masked, and refuses an unknown id", async () => {
		const c = await served();
		const demo = DaemonMcpTestResultSchema.parse(
			await c.sendRequest(DAEMON_METHODS.mcpTest, { id: "demo" }),
		);
		expect(demo.ok && demo.tools).toContain("echo");
		const broken = DaemonMcpTestResultSchema.parse(
			await c.sendRequest(DAEMON_METHODS.mcpTest, { id: "broken" }),
		);
		expect(broken.ok).toBe(false);
		const message = broken.ok ? "" : broken.failed.message;
		expect(message).toMatch(/^MCP server broken: .*refused/s);
		expect(message).not.toContain(TOKEN);
		const unknown = await c
			.sendRequest(DAEMON_METHODS.mcpTest, { id: "later" })
			.catch((e: unknown) => e);
		expect(unknown instanceof ResponseError && unknown.data).toEqual({
			code: "not_found",
		});
		const bad = await c
			.sendRequest(DAEMON_METHODS.mcpTest, {})
			.catch((e: unknown) => e);
		expect(bad instanceof ResponseError).toBe(true);
	});
});
