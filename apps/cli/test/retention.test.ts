import { execFileSync } from "node:child_process";
import { join } from "node:path";
import type { ChatChunk, StorageSqlAdapter } from "@mete/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCommand } from "../src/application/commands.js";
import { type App, createApp } from "../src/infrastructure/app.js";
import {
	memorySecrets,
	recordingIo,
	scriptedProvider,
	silent,
	tempRepo,
} from "./helpers.js";

// Checkpoints are kept 14 days after the run ends (SECURITY.md), through every real module: a real
// git checkpoint, the run's end moved into the past, and the app started again as the daemon does.

const finish = (reason: "stop" | "tool-calls"): ChatChunk => ({
	type: "finish",
	reason,
	usage: { prompt: 10, completion: 5 },
});
const EDIT: ChatChunk[][] = [
	[
		{
			type: "tool-call",
			id: "c1",
			name: "fs_edit",
			args: { path: "greet.js", oldStr: "Helo", newStr: "Hello" },
		},
		finish("tool-calls"),
	],
	[{ type: "text", text: "Fixed." }, finish("stop")],
];
const DAY = 86_400_000;

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
	await close?.();
	close = undefined;
});

const refs = (dir: string) =>
	execFileSync(
		"git",
		["for-each-ref", "--format=%(refname)", "refs/mete/checkpoints/"],
		{
			cwd: dir,
			encoding: "utf8",
		},
	)
		.split("\n")
		.filter(Boolean);

// Moves every run's end `days` into the past, as if it ended then.
const endedDaysAgo = (app: App, days: number) => {
	const sql = app.registry.resolve<StorageSqlAdapter>("storage.sql@1");
	if (!sql.ok) throw new Error("storage.sql@1 is not active");
	sql.value[0].impl
		.scopeFor("cli")
		.workspace.prepare("UPDATE runs SET ended_at = ?")
		.run(new Date(Date.now() - days * DAY).toISOString());
};

const appFor = (
	repo: Awaited<ReturnType<typeof tempRepo>>,
	script: ChatChunk[][],
) =>
	createApp({
		workspaceDir: repo.workspaceDir,
		globalDir: repo.globalDir,
		templatesDir: join(repo.globalDir, "no-templates"),
		logger: silent,
		secrets: memorySecrets(),
		providers: [scriptedProvider({ script })],
	});

// Runs the fixture once, ends it `days` ago, and starts the app again; returns the repository.
const runEndedDaysAgo = async (days: number) => {
	const repo = await tempRepo({
		"greet.js": 'export const greet = (n) => "Helo " + n;\n',
	});
	const first = await appFor(repo, EDIT);
	if (!first.ok) throw new Error(JSON.stringify(first.error));
	expect(
		await runCommand(first.value, recordingIo().io, { goal: "fix the typo" }),
	).toBe(0);
	expect(refs(repo.workspaceDir)).toHaveLength(1);
	endedDaysAgo(first.value, days);
	await first.value.stop();
	const again = await appFor(repo, []);
	if (!again.ok) throw new Error(JSON.stringify(again.error));
	close = async () => {
		await again.value.stop();
		await repo.close();
	};
	return repo;
};

describe("checkpoint retention", () => {
	it("removes the checkpoints of a run that ended 20 days ago when the app starts again", async () => {
		const repo = await runEndedDaysAgo(20);
		await vi.waitFor(() => expect(refs(repo.workspaceDir)).toEqual([]));
	});

	it("keeps the checkpoints of a run that ended yesterday", async () => {
		const repo = await runEndedDaysAgo(1);
		// The sweep runs right after activation; give it the time a removal would take.
		await new Promise((r) => setTimeout(r, 300));
		expect(refs(repo.workspaceDir)).toHaveLength(1);
	});
});
