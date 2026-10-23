import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCommand } from "../src/application/commands.js";
import { NO_GIT_LINE } from "../src/application/run-hints.js";
import { createApp } from "../src/infrastructure/app.js";
import {
	memorySecrets,
	recordingIo,
	scriptedProvider,
	silent,
	tempRepo,
} from "./helpers.js";

// What `mete run` says before and while a run when the folder or the providers lack something,
// through every real module; only the provider behind the gateway is scripted.

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
	await close?.();
	close = undefined;
});

const DONE = [
	[
		{ type: "text" as const, text: "done" },
		{
			type: "finish" as const,
			reason: "stop" as const,
			usage: { prompt: 1, completion: 1 },
		},
	],
];

const appIn = async (workspaceDir: string, globalDir: string) => {
	const app = await createApp({
		workspaceDir,
		globalDir,
		templatesDir: join(globalDir, "no-templates"),
		logger: silent,
		secrets: memorySecrets(),
		providers: [scriptedProvider({ script: DONE })],
	});
	if (!app.ok) throw new Error(JSON.stringify(app.error));
	return app.value;
};

describe("mete run start checks", () => {
	it("says before the run that a folder without git works in place, and still runs", async () => {
		const root = await mkdtemp(join(tmpdir(), "mete-nogit-"));
		await writeFile(join(root, "a.txt"), "a\n");
		const app = await appIn(root, join(root, "global"));
		close = async () => {
			await app.stop();
			await rm(root, { recursive: true, force: true });
		};
		const t = recordingIo();
		expect(await runCommand(app, t.io, { goal: "g", templateId: null })).toBe(
			0,
		);
		expect(t.err[0]).toBe(NO_GIT_LINE);
		expect(t.out.at(-1)).toBe("completed\ndone");
	});

	it("says nothing about git in a repository", async () => {
		const repo = await tempRepo({ "a.txt": "a\n" });
		const app = await appIn(repo.workspaceDir, repo.globalDir);
		close = async () => {
			await app.stop();
			await repo.close();
		};
		const t = recordingIo();
		expect(await runCommand(app, t.io, { goal: "g", templateId: null })).toBe(
			0,
		);
		expect(t.err).not.toContain(NO_GIT_LINE);
	});
});
