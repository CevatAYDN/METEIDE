import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { DAEMON_METHODS, DaemonSettingsResultSchema } from "@mete/contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
	createMessageConnection,
	StreamMessageReader,
	StreamMessageWriter,
} from "vscode-jsonrpc/node";
import { daemonCommand } from "../src/application/daemon.js";
import { createApp } from "../src/infrastructure/app.js";
import { memorySecrets, recordingIo, silent, tempRepo } from "./helpers.js";

// `mete/settings` (ADR-081) through every real module: a section in the global settings.yaml, one in
// .mete/, and a token-shaped string that must come back masked.

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
	await close?.();
	close = undefined;
});

// Built at runtime so no secret-shaped literal sits in the repository.
const token = () => `ghp_${"A1b2C3d4E5".repeat(3)}aBcDeF`;

describe("mete/settings", () => {
	it("answers each loaded section merged and per file, with strings masked", async () => {
		const repo = await tempRepo({ "a.txt": "a\n" });
		await mkdir(repo.globalDir, { recursive: true });
		await mkdir(join(repo.workspaceDir, ".mete"), { recursive: true });
		await writeFile(
			join(repo.globalDir, "settings.yaml"),
			"gateway:\n  models: free\n",
		);
		await writeFile(
			join(repo.workspaceDir, ".mete", "mcp.yaml"),
			`servers:\n  - id: tool\n    transport: stdio\n    runtime: node\n    command: npx\n    args: ["--token", "${token()}"]\n`,
		);
		const app = await createApp({
			workspaceDir: repo.workspaceDir,
			globalDir: repo.globalDir,
			templatesDir: join(repo.globalDir, "no-templates"),
			logger: silent,
			secrets: memorySecrets(),
			providers: [],
		});
		if (!app.ok) throw new Error(JSON.stringify(app.error));
		close = async () => {
			await app.value.stop();
			await repo.close();
		};
		const [toDaemon, toClient] = [new PassThrough(), new PassThrough()];
		const serving = daemonCommand(
			app.value,
			recordingIo().io,
			repo.workspaceDir,
			{
				input: toDaemon,
				output: toClient,
			},
		);
		const c = createMessageConnection(
			new StreamMessageReader(toClient),
			new StreamMessageWriter(toDaemon),
		);
		c.listen();
		const answer = DaemonSettingsResultSchema.parse(
			await c.sendRequest(DAEMON_METHODS.settings),
		);
		const byName = new Map(answer.sections.map((s) => [s.name, s]));
		expect([...byName.keys()]).toEqual(["gateway", "mcp", "workspace"]);
		const gateway = byName.get("gateway");
		expect(gateway?.global?.file).toBe(join(repo.globalDir, "settings.yaml"));
		expect(gateway?.workspace).toBeUndefined();
		expect(gateway?.merged).toEqual({ models: "free" });
		const mcp = byName.get("mcp");
		expect(mcp?.global).toBeUndefined();
		expect(mcp?.workspace?.file).toBe(
			join(repo.workspaceDir, ".mete", "mcp.yaml"),
		);
		const text = JSON.stringify(answer);
		expect(text).not.toContain(token());
		expect(text).toMatch(/\[SECRET:[0-9a-f]{8}\]/);
		expect(Date.parse(answer.loadedAt)).not.toBeNaN();
		toDaemon.end();
		expect(await serving).toBe(0);
		c.dispose();
	});
});
