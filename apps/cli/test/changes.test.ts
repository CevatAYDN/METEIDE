import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { DAEMON_METHODS } from "@mete/contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
	createMessageConnection,
	StreamMessageReader,
	StreamMessageWriter,
} from "vscode-jsonrpc/node";
import { changeOf, changesOf } from "../src/application/changes.js";
import { daemonCommand } from "../src/application/daemon.js";
import { type App, createApp } from "../src/infrastructure/app.js";
import { memorySecrets, recordingIo, silent, tempRepo } from "./helpers.js";

// The Changes panel's read (ADR-100): vcs.git@2's porcelain letters as the words the panel shows,
// and the working tree of a real repository through the app's registry.

const started = async (workspaceDir: string, globalDir: string) => {
	const made = await createApp({
		workspaceDir,
		globalDir,
		templatesDir: join(globalDir, "no-templates"),
		logger: silent,
		secrets: memorySecrets(),
		providers: [],
	});
	if (!made.ok) throw new Error("the app did not start");
	return made.value;
};

let app: App | undefined;
let close: (() => Promise<void>) | undefined;
afterEach(async () => {
	await app?.stop();
	app = undefined;
	await close?.();
	close = undefined;
});

describe("changeOf", () => {
	it("reads a porcelain row as a word", () => {
		expect(changeOf("?", "?")).toBe("untracked");
		expect(changeOf("A", " ")).toBe("added");
		expect(changeOf(" ", "D")).toBe("deleted");
		expect(changeOf("R", " ")).toBe("renamed");
		expect(changeOf(" ", "M")).toBe("modified");
		expect(changeOf("M", "M")).toBe("modified");
	});
});

describe("changesOf", () => {
	it("lists a clean repository with its branch and no file", async () => {
		const repo = await tempRepo({ "greet.js": "export const hi = 1;\n" });
		close = repo.close;
		app = await started(repo.workspaceDir, repo.globalDir);
		expect(await changesOf(app)).toEqual({
			vcs: true,
			branch: "main",
			files: [],
		});
	});

	it("names a modified, an untracked and a deleted file, and gives one diff", async () => {
		const repo = await tempRepo({
			"greet.js": 'export const greet = () => "Hello";\n',
			"gone.js": "export const gone = 1;\n",
		});
		close = repo.close;
		await writeFile(
			join(repo.workspaceDir, "greet.js"),
			'export const greet = () => "Hi";\n',
		);
		await writeFile(join(repo.workspaceDir, "new.js"), "export const n = 2;\n");
		await unlink(join(repo.workspaceDir, "gone.js"));
		app = await started(repo.workspaceDir, repo.globalDir);
		const list = await changesOf(app);
		expect(list.vcs).toBe(true);
		expect(list.branch).toBe("main");
		expect(
			[...list.files].sort((a, b) => a.path.localeCompare(b.path)),
		).toEqual([
			{ path: "gone.js", change: "deleted" },
			{ path: "greet.js", change: "modified" },
			{ path: "new.js", change: "untracked" },
		]);
		const one = await changesOf(app, "greet.js");
		expect(one.diff).toContain('-export const greet = () => "Hello";');
		expect(one.diff).toContain('+export const greet = () => "Hi";');
	});

	it("answers mete/changes over the protocol", async () => {
		const repo = await tempRepo({ "a.txt": "a\n" });
		close = repo.close;
		app = await started(repo.workspaceDir, repo.globalDir);
		await writeFile(join(repo.workspaceDir, "a.txt"), "b\n");
		const [toDaemon, toClient] = [new PassThrough(), new PassThrough()];
		const serving = daemonCommand(app, recordingIo().io, repo.workspaceDir, {
			input: toDaemon,
			output: toClient,
		});
		const client = createMessageConnection(
			new StreamMessageReader(toClient),
			new StreamMessageWriter(toDaemon),
		);
		client.listen();
		const answer = await client.sendRequest(DAEMON_METHODS.changes, {});
		expect(answer).toEqual({
			vcs: true,
			branch: "main",
			files: [{ path: "a.txt", change: "modified" }],
		});
		toDaemon.end();
		await serving;
	});

	it("answers vcs false for a folder that is not a repository", async () => {
		const root = await mkdtemp(join(tmpdir(), "mete-plain-"));
		close = () => rm(root, { recursive: true, force: true });
		app = await started(root, join(root, "global"));
		expect(await changesOf(app)).toEqual({
			vcs: false,
			branch: null,
			files: [],
		});
	});
});
