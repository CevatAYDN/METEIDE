import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ChatChunk, ChatRequest } from "@mete/contracts";
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

// A writing team task through the real fs and vcs tools (docs/08, Parallel work and merging): its
// file is written in a worktree of its own, and the approved task's branch is merged into the
// workspace before the run completes. Only the model is scripted.

const TEAM = `apiVersion: mete/v1
kind: TeamTemplate
metadata: { id: build, name: Build, version: 1.0.0 }
pattern: single
roles:
  - { id: dev, name: Dev, goal: Write the notes file, tier: coder, needs: [tool_calling], capabilities: [fs.write@1] }
tasks:
  - { id: notes, role: dev, title: Add notes }
`;

const finish = (reason: "stop" | "tool-calls"): ChatChunk => ({
	type: "finish",
	reason,
	usage: { prompt: 10, completion: 5 },
});
const script: ChatChunk[][] = [
	[
		{
			type: "tool-call",
			id: "c1",
			name: "fs_write",
			args: { path: "notes.txt", content: "hello\n" },
		},
		finish("tool-calls"),
	],
	[{ type: "text", text: "wrote notes.txt" }, finish("stop")],
];

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
	await close?.();
	close = undefined;
});

const exists = (p: string) =>
	access(p).then(
		() => true,
		() => false,
	);

describe("a writing team task", () => {
	it("works in its own worktree and lands in the workspace once approved", async () => {
		const repo = await tempRepo({ "README.md": "# notes\n" });
		const mete = join(repo.workspaceDir, ".mete");
		await mkdir(join(mete, "teams"), { recursive: true });
		await writeFile(join(mete, "teams", "build.yaml"), TEAM);
		await writeFile(join(mete, "policy.yaml"), "autonomy: 3\n");
		const seen: ChatRequest[] = [];
		const app = await createApp({
			workspaceDir: repo.workspaceDir,
			globalDir: repo.globalDir,
			logger: silent,
			secrets: memorySecrets(),
			providers: [scriptedProvider({ script, seen })],
		});
		if (!app.ok) throw new Error(JSON.stringify(app.error));
		close = async () => {
			await app.value.stop();
			await repo.close();
		};
		const t = recordingIo();
		const code = await runCommand(app.value, t.io, {
			goal: "write notes",
			templateId: "build",
		});
		expect(code).toBe(0);
		const runId = /^run (\S+) started$/.exec(t.out[0] ?? "")?.[1] ?? "";

		// The file reached the workspace through a merge commit named after the task.
		expect(await readFile(join(repo.workspaceDir, "notes.txt"), "utf8")).toBe(
			"hello\n",
		);
		expect(await repo.git("log", "-1", "--format=%s")).toBe("Add notes");
		expect(await repo.git("log", "-1", "--format=%p")).toMatch(/\S+ \S+/);
		expect(await repo.git("status", "--porcelain", "--", "notes.txt")).toBe("");
		// The worktree and its branch are gone once merged.
		const trees = join(repo.globalDir, "worktrees", runId);
		expect(await exists(trees)).toBe(false);
		expect(await repo.git("branch", "--list", "mete/*")).toBe("");

		const events = runHistory(app.value.registry, runId)?.events ?? [];
		const checkpoints = events.filter((e) => e.type === "checkpoint.created");
		expect(checkpoints).toHaveLength(2);
		expect(events.map((e) => e.type)).not.toContain("task.merge.failed");
	}, 60_000);
});
