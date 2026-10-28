import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ChatChunk } from "@mete/contracts";
import type { BrowserOptions } from "@mete/tools";
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

// The built-in web-dev template through every real module but the models and the browser (docs/08,
// Built-in templates): the developer writes a site in a worktree of its own and must pass
// `npm run build`, the merge lands it in the workspace, QA builds it again in its own worktree and
// audits the built folder, and the lead approves each step. Real fs, shell, git and npm.

const finish = (reason: "stop" | "tool-calls"): ChatChunk => ({
	type: "finish",
	reason,
	usage: { prompt: 10, completion: 5 },
});
const say = (text: string): ChatChunk[] => [
	{ type: "text", text },
	finish("stop"),
];
const calls = (...list: [string, unknown][]): ChatChunk[] => [
	...list.map(
		([name, args], i): ChatChunk => ({
			type: "tool-call",
			id: `c${i}-${name}`,
			name,
			args,
		}),
	),
	finish("tool-calls"),
];
const write = (path: string, content: string): [string, unknown] => [
	"fs_write",
	{ path, content },
];
const APPROVE = say('{"decision":"approve"}');

const SITE: [string, unknown][] = [
	write(
		"package.json",
		'{ "name": "page", "private": true, "scripts": { "build": "node build.mjs" } }\n',
	),
	write(
		"build.mjs",
		'import { cpSync, mkdirSync } from "node:fs";\nmkdirSync("dist", { recursive: true });\ncpSync("src", "dist", { recursive: true });\n',
	),
	write(
		"src/index.html",
		'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Hi</title><meta name="description" content="A page."></head><body><h1>Hi</h1></body></html>\n',
	),
	write(".gitignore", "node_modules\ndist\n"),
];

const LHR = {
	categories: {
		performance: { score: 0.97 },
		accessibility: { score: 1 },
		"best-practices": { score: 1 },
		seo: { score: 0.92 },
	},
	audits: {
		"meta-description": {
			id: "meta-description",
			title: "Has a meta description",
			score: 1,
		},
	},
};
const PNG = Buffer.from(
	"89504e470d0a1a0a0000000d4948445200000500000002d0",
	"hex",
);

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

describe("the web-dev template", () => {
	it("builds a page in a worktree, lands it, and audits the built folder from QA's own worktree", async () => {
		const repo = await tempRepo({ "README.md": "# site\n" });
		await mkdir(join(repo.workspaceDir, ".mete"), { recursive: true });
		// The built-in policy keeps shell.exec@1 at level 1; level 2 lets the allow-listed npm run commands through.
		await writeFile(
			join(repo.workspaceDir, ".mete", "policy.yaml"),
			"autonomy: 3\noverrides:\n  shell.exec@1: 2\n",
		);
		const script = [
			// The designer asks the researcher before it writes (ADR-142) and has no questions.
			say("none"),
			say("Brief: one section with a heading."),
			APPROVE,
			calls(...SITE),
			calls(["shell_exec", { command: "npm run build" }]),
			say("package.json, build.mjs, src/index.html, .gitignore"),
			APPROVE,
			calls(["shell_exec", { command: "npm run build" }]),
			calls(["seo_audit", { folder: "dist" }]),
			say("Build passed. Scores 97, 100, 100, 92; all at least 85."),
			APPROVE,
		];
		const audited: unknown[] = [];
		const browser: Pick<BrowserOptions, "run" | "chromium"> = {
			run: async (req) => {
				audited.push(req.target);
				await writeFile(
					req.out,
					req.kind === "screenshot" ? PNG : JSON.stringify(LHR),
				);
				return { ok: true, value: undefined };
			},
			chromium: {
				installed: () => true,
				install: async () => ({ ok: true, value: undefined }),
			},
		};
		const app = await createApp({
			workspaceDir: repo.workspaceDir,
			globalDir: repo.globalDir,
			logger: silent,
			secrets: memorySecrets(),
			providers: [scriptedProvider({ script })],
			browser,
		});
		if (!app.ok) throw new Error(JSON.stringify(app.error));
		close = async () => {
			await app.value.stop();
			await repo.close();
		};
		const t = recordingIo();
		const code = await runCommand(app.value, t.io, {
			goal: "a one-page site that says hi",
			templateId: "web-dev",
		});
		expect(t.err).toEqual([]);
		expect(code).toBe(0);
		const runId = /^run (\S+) started$/.exec(t.out[0] ?? "")?.[1] ?? "";

		// The developer's files landed in the workspace through a merge commit named after its task;
		// dist stayed out of git, so the workspace has no build output of its own.
		for (const f of [
			"package.json",
			"build.mjs",
			"src/index.html",
			".gitignore",
		])
			expect(await exists(join(repo.workspaceDir, f)), f).toBe(true);
		expect(await exists(join(repo.workspaceDir, "dist"))).toBe(false);
		expect(await readFile(join(repo.workspaceDir, ".gitignore"), "utf8")).toBe(
			"node_modules\ndist\n",
		);
		expect(await repo.git("log", "--format=%s", "-3")).toContain(
			"Build the page and pass the build",
		);

		// QA audited the dist folder of its own worktree, under the global worktrees folder.
		expect(audited).toHaveLength(1);
		const target = audited[0] as { folder: string };
		expect(target.folder).toContain(join(repo.globalDir, "worktrees", runId));
		expect(target.folder.endsWith("dist")).toBe(true);

		// Gate and tools ran: npm run build by the developer, by the gate and by QA.
		const events = runHistory(app.value.registry, runId)?.events ?? [];
		const used = (cap: string) =>
			events.filter(
				(e) => e.type === "agent.tool.called" && e.payload.capability === cap,
			).length;
		expect(used("fs.write@1")).toBe(4);
		expect(used("shell.exec@1")).toBe(3);
		expect(used("seo.audit@2")).toBe(1);
		expect(events.map((e) => e.type)).not.toContain("task.merge.failed");
		// Every worktree and its run folder are gone once merged.
		expect(await exists(join(repo.globalDir, "worktrees", runId))).toBe(false);
	}, 180_000);
});
