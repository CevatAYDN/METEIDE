import { access, mkdir, writeFile } from "node:fs/promises";
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

// ADR-120 through every real module but the model: a workspace mapping makes `node check.mjs "a b"`
// the team's gameengine.build@1, the developer's verify gate calls it in the task's worktree through
// the real shell (PowerShell on Windows), the policy's allow list lets the line through, and the gate
// fails until the developer writes check.mjs.

const finish = (reason: "stop" | "tool-calls"): ChatChunk => ({
	type: "finish",
	reason,
	usage: { prompt: 10, completion: 5 },
});
const say = (text: string): ChatChunk[] => [
	{ type: "text", text },
	finish("stop"),
];
const write = (path: string, content: string): ChatChunk[] => [
	{ type: "tool-call", id: "c0", name: "fs_write", args: { path, content } },
	finish("tool-calls"),
];

const MAPPING = `apiVersion: mete/v1
kind: AdapterMapping
metadata: { id: check, version: 1.0.0 }
type: cli
implements:
  gameengine.build@1:
    command: node
    args: [check.mjs, "a b"]
    success: { exitCode: 0 }
    output: { log: "{{result.stdout}}" }
`;

const TEAM = `apiVersion: mete/v1
kind: TeamTemplate
metadata: { id: checked, name: Checked, version: 1.0.0 }
pattern: single
roles:
  - { id: dev, name: Dev, goal: Build, tier: coder, capabilities: [fs.write@1] }
tasks:
  - { id: build, role: dev, title: Build and pass the check, verify: [{ capability: gameengine.build@1 }] }
`;

// Exits 2 unless the second word arrived as one argument.
const CHECK =
	"if (process.argv[2] !== 'a b') process.exit(2);\nconsole.log('checked ' + process.argv[2]);\n";

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

describe("a cli mapping as a verify gate", () => {
	it("fails the gate until the developer writes the program it runs, then lands the task", async () => {
		const repo = await tempRepo({ "README.md": "# game\n" });
		const mete = join(repo.workspaceDir, ".mete");
		await mkdir(join(mete, "adapters"), { recursive: true });
		await mkdir(join(mete, "teams"));
		await writeFile(join(mete, "adapters", "check.yaml"), MAPPING);
		await writeFile(join(mete, "teams", "checked.yaml"), TEAM);
		// Level 2 for commands, so only the allow list lets the mapped line through without asking.
		await writeFile(
			join(mete, "policy.yaml"),
			'autonomy: 3\noverrides:\n  shell.exec@1: 2\nshell:\n  allow: ["node *"]\n',
		);
		const script = [say("done"), write("check.mjs", CHECK), say("done")];
		const app = await createApp({
			workspaceDir: repo.workspaceDir,
			globalDir: repo.globalDir,
			logger: silent,
			secrets: memorySecrets(),
			providers: [scriptedProvider({ script })],
		});
		if (!app.ok) throw new Error(JSON.stringify(app.error));
		close = async () => {
			await app.value.stop();
			await repo.close();
		};
		const t = recordingIo();
		const code = await runCommand(app.value, t.io, {
			goal: "a game that builds",
			templateId: "checked",
		});
		expect(t.err).toEqual([]);
		expect(code).toBe(0);
		const runId = /^run (\S+) started$/.exec(t.out[0] ?? "")?.[1] ?? "";
		const events = runHistory(app.value.registry, runId)?.events ?? [];
		expect(
			events
				.filter((e) => e.type === "verify.completed")
				.map((e) => ({ gate: e.payload.gate, ok: e.payload.ok })),
		).toEqual([
			{ gate: "gameengine.build@1", ok: false },
			{ gate: "gameengine.build@1", ok: true },
		]);
		const failed = events.find((e) => e.type === "verify.completed");
		expect(String(failed?.payload.details)).toContain(
			'node check.mjs "a b" exited with 1',
		);
		expect(await exists(join(repo.workspaceDir, "check.mjs"))).toBe(true);
	}, 180_000);
});
