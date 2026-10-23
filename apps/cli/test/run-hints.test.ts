import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNvidiaModule } from "@mete/providers";
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

const READ = [
	{
		type: "tool-call" as const,
		id: "c1",
		name: "fs_read",
		args: { path: "a.txt" },
	},
	{
		type: "finish" as const,
		reason: "tool-calls" as const,
		usage: { prompt: 1, completion: 1 },
	},
];

const until = async (ok: () => boolean) => {
	for (let i = 0; i < 100 && !ok(); i++)
		await new Promise((r) => setTimeout(r, 50));
};

describe("mete run quota pause", () => {
	it("names after a quota pause each provider that cannot carry the run on, and why", async () => {
		const repo = await tempRepo({ "a.txt": "a\n" });
		const app = await createApp({
			workspaceDir: repo.workspaceDir,
			globalDir: repo.globalDir,
			templatesDir: join(repo.globalDir, "no-templates"),
			logger: silent,
			secrets: memorySecrets(),
			providers: [
				// One request a day: the first call takes it, so the next one finds the quota spent until
				// tomorrow, longer than the scheduler waits, and the run pauses for quota.
				scriptedProvider(
					{ script: [READ, ...DONE] },
					{ limit: 1, daily: true },
				),
				scriptedProvider({ noModels: true }, { id: "shy" }),
				createNvidiaModule(),
			],
		});
		if (!app.ok) throw new Error(JSON.stringify(app.error));
		close = async () => {
			await app.value.stop();
			await repo.close();
		};
		const t = recordingIo();
		const run = runCommand(app.value, t.io, { goal: "g", templateId: null });
		await until(() => t.err.some((l) => l.includes("nvidia: no key")));
		t.interrupt();
		expect(await run).toBe(1);
		const lines = t.err.filter((l) => l.startsWith("  "));
		expect(lines).toHaveLength(3);
		expect(lines[0]).toMatch(/^ {2}fake: its free quota is used up until /);
		expect(lines[1]).toBe(
			"  shy: none of its models can be used here (the privacy rules may leave them out: allowTraining in privacy.yaml; the model mode may: models in gateway.yaml; or its key was refused)",
		);
		expect(lines[2]).toBe("  nvidia: no key (mete key set nvidia)");
	});
});
