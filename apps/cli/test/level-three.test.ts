import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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

// The line a level-3 run prints when it writes outside a worktree (SECURITY.md, Autonomy levels):
// a single-agent run, or a team run without vcs.git@2. A team run with it prints nothing.

const NOTE =
	"autonomy 3: verify gates and worktrees are not available yet (SECURITY.md); the run goes on with checkpoints only";

const TEAM = `apiVersion: mete/v1
kind: TeamTemplate
metadata: { id: solo, name: Solo, version: 1.0.0 }
pattern: single
roles:
  - { id: thinker, name: Thinker, goal: Answer, tier: fast, capabilities: [] }
tasks:
  - { id: answer, role: thinker, title: Answer }
`;

const script: ChatChunk[][] = [
	[
		{ type: "text", text: "done" },
		{ type: "finish", reason: "stop", usage: { prompt: 1, completion: 1 } },
	],
];

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const c of cleanups.splice(0)) await c();
});

// A workspace at autonomy 3, in a git repository or in a plain folder, with the team template in it.
const workspace = async (git: boolean) => {
	const repo = git ? await tempRepo({ "a.txt": "a\n" }) : undefined;
	const plain = repo ? undefined : await mkdtemp(join(tmpdir(), "mete-plain-"));
	const dir = repo?.workspaceDir ?? plain ?? "";
	const globalDir =
		repo?.globalDir ?? (await mkdtemp(join(tmpdir(), "mete-plain-global-")));
	await mkdir(join(dir, ".mete", "teams"), { recursive: true });
	await writeFile(join(dir, ".mete", "policy.yaml"), "autonomy: 3\n");
	await writeFile(join(dir, ".mete", "teams", "solo.yaml"), TEAM);
	const app = await createApp({
		workspaceDir: dir,
		globalDir,
		templatesDir: join(globalDir, "no-templates"),
		logger: silent,
		secrets: memorySecrets(),
		providers: [scriptedProvider({ script })],
	});
	if (!app.ok) throw new Error(JSON.stringify(app.error));
	cleanups.push(async () => {
		await app.value.stop();
		if (repo) await repo.close();
		else {
			await rm(dir, { recursive: true, force: true });
			await rm(globalDir, { recursive: true, force: true });
		}
	});
	return app.value;
};

const notes = async (
	git: boolean,
	what: { goal: string; templateId?: string },
) => {
	const t = recordingIo();
	const code = await runCommand(await workspace(git), t.io, what);
	return { code, said: t.err.filter((l) => l.startsWith("autonomy 3:")) };
};

describe("the level-3 notice", () => {
	it("is printed once for a single-agent run, which has no worktree", async () => {
		const r = await notes(true, { goal: "say done" });
		expect(r.code).toBe(0);
		expect(r.said).toEqual([NOTE]);
	});

	it("is printed once for a team run in a folder without git, which has no vcs.git@2", async () => {
		const r = await notes(false, { goal: "answer", templateId: "solo" });
		expect(r.code).toBe(0);
		expect(r.said).toEqual([NOTE]);
	});

	it("is not printed for a team run in a git repository", async () => {
		const r = await notes(true, { goal: "answer", templateId: "solo" });
		expect(r.code).toBe(0);
		expect(r.said).toEqual([]);
	});
});
