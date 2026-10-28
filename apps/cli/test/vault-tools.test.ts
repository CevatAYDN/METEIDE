import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ChatChunk } from "@mete/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { runCommand } from "../src/application/commands.js";
import { createApp } from "../src/infrastructure/app.js";
import { runHistory } from "../src/infrastructure/history.js";
import {
	memorySecrets,
	recordingIo,
	scriptedProvider,
	silent,
	tempRepo,
} from "./helpers.js";

// The vault tools through every real module but the model (docs/11, Vaults; ADR-145): a team role
// that names vault.write@1 gets vault_write; its call goes through the real fs.write@1 and the
// policy at the default autonomy level from the task's worktree, the note lands in the workspace
// vault, and storage keeps the vault.note.saved the 3-notes limit counts.

const finish = (reason: "stop" | "tool-calls"): ChatChunk => ({
	type: "finish",
	reason,
	usage: { prompt: 10, completion: 5 },
});
const LESSON: ChatChunk[][] = [
	[
		{
			type: "tool-call",
			id: "c1",
			name: "vault_write",
			args: {
				type: "lesson",
				title: "Edit files with exact matches",
				body: "fs_edit needs the old text exactly once.",
			},
		},
		finish("tool-calls"),
	],
	[{ type: "text", text: "Saved the lesson." }, finish("stop")],
];

// fs.write@1 gives the task a worktree, so the call comes with that worktree as its cwd.
const TEAM = `apiVersion: mete/v1
kind: TeamTemplate
metadata: { id: learner, name: Learner, version: 1.0.0 }
pattern: single
roles:
  - { id: dev, name: Dev, goal: Learn, tier: coder, capabilities: [fs.write@1, vault.write@1] }
tasks:
  - { id: learn, role: dev, title: Save what you learned }
`;

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
	await close?.();
	close = undefined;
});

describe("vault tools", () => {
	it("save a team role's lesson in the workspace vault through the real fs.write@1", async () => {
		const repo = await tempRepo({ "a.txt": "a\n" });
		const teams = join(repo.workspaceDir, ".mete", "teams");
		await mkdir(teams, { recursive: true });
		await writeFile(join(teams, "learner.yaml"), TEAM);
		const app = await createApp({
			workspaceDir: repo.workspaceDir,
			globalDir: repo.globalDir,
			logger: silent,
			secrets: memorySecrets(),
			providers: [scriptedProvider({ script: LESSON })],
		});
		if (!app.ok) throw new Error(JSON.stringify(app.error));
		close = async () => {
			await app.value.stop();
			await repo.close();
		};
		const t = recordingIo();
		const code = await runCommand(app.value, t.io, {
			goal: "Learn",
			templateId: "learner",
		});
		expect([code, t.err]).toEqual([0, []]);
		const runId = /^run (\S+) started$/.exec(t.out[0] ?? "")?.[1] ?? "";
		const path = ".mete/knowledge/lessons/edit-files-with-exact-matches.md";
		const text = await readFile(join(repo.workspaceDir, path), "utf8");
		expect(text).toMatch(
			/^---\ntype: lesson\ntitle: Edit files with exact matches\n/,
		);
		expect(text).toContain(`source: run/${runId}\n`);
		expect(text).toContain("fs_edit needs the old text exactly once.\n");
		// Written in the workspace, not in the task's worktree, so the task's merge never brought it.
		expect(await repo.git("ls-files", "--", path)).toBe("");
		// The run report's journal note may follow; the lesson is the run's one other note.
		const saved = (runHistory(app.value.registry, runId)?.events ?? []).flatMap(
			(e) =>
				e.type === "vault.note.saved" && e.payload.noteType !== "journal"
					? [e.payload]
					: [],
		);
		expect(saved).toEqual([{ path, noteType: "lesson" }]);
	});
});
