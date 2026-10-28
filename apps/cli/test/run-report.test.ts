import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ChatChunk } from "@mete/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { runCommand } from "../src/application/commands.js";
import { createApp } from "../src/infrastructure/app.js";
import {
	memorySecrets,
	recordingIo,
	scriptedProvider,
	silent,
	tempRepo,
} from "./helpers.js";

// A run report through every real module (docs/11, Run reports; ADR-144): storage keeps the run's
// events, the vault module reads them back through events.read@1 once the run has ended, and the
// day's journal note lists what the run did, the files its handoff names included.

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
			args: { path: "a.txt", oldStr: "a", newStr: "b" },
		},
		finish("tool-calls"),
	],
	[{ type: "text", text: "Changed a to b." }, finish("stop")],
];

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
	await close?.();
	close = undefined;
});

describe("run report", () => {
	it("lands in the workspace journal with the run's changed file", async () => {
		const repo = await tempRepo({ "a.txt": "a\n" });
		close = repo.close;
		const app = await createApp({
			workspaceDir: repo.workspaceDir,
			globalDir: repo.globalDir,
			templatesDir: join(repo.globalDir, "no-templates"),
			logger: silent,
			secrets: memorySecrets(),
			providers: [scriptedProvider({ script: EDIT })],
		});
		if (!app.ok) throw new Error(JSON.stringify(app.error));
		const io = recordingIo().io;
		expect(await runCommand(app.value, io, { goal: "Change a to b" })).toBe(0);
		await app.value.stop();
		const dir = join(repo.workspaceDir, ".mete", "knowledge", "journal");
		const [note, ...more] = await readdir(dir);
		expect(more).toEqual([]);
		const text = await readFile(join(dir, note ?? ""), "utf8");
		expect(text).toMatch(/^---\ntype: journal\n/);
		expect(text).toContain("## Change a to b\n");
		expect(text).toContain("- Team: single agent\n- Status: completed\n");
		expect(text).toContain("- Tool calls: fs.edit@1\n");
		expect(text).toContain("- Changed files: `a.txt`\n");
		expect(text).toContain("> Changed a to b.");
	});
});
