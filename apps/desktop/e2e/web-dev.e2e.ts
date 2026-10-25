import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, runCommand, test } from "./launch.js";

// The Phase 5 gate's template acceptance as a user drives it (ROADMAP.md; docs/15): the web-dev team
// builds a page in a worktree of its own, must pass `npm run build`, merges it into the workspace and
// audits the built folder. The models, the screenshot and the Lighthouse report come from the test's
// scripts (ADR-111, ADR-117), so the app needs no provider key, starts no Chromium and reaches no
// network; the real fs, shell, git, npm, the engine and the panels stay the ones a user runs.

const write = (path: string, content: string) => [
	"fs_write",
	{ path, content },
];

const SITE = [
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

const finish = (reason: "stop" | "tool-calls") => ({
	type: "finish",
	reason,
	usage: { prompt: 10, completion: 5 },
});
const say = (text: string) => [{ type: "text", text }, finish("stop")];
const call = (name: string, args: unknown) => [
	{ type: "tool-call", id: `c-${name}`, name, args },
	finish("tool-calls"),
];
const calls = (...list: [string, unknown][]) => [
	...list.map(([name, args], i) => ({
		type: "tool-call",
		id: `c${i}-${name}`,
		name,
		args,
	})),
	finish("tool-calls"),
];
const APPROVE = say('{"decision":"approve"}');

test.use({
	// Level 3 asks for the worktrees and the verify gate; the override lets the allow-listed npm run
	// commands through without a question (docs/08, Built-in templates; SECURITY.md).
	files: {
		"README.md": "# site\n",
		".mete/policy.yaml": "autonomy: 3\noverrides:\n  shell.exec@1: 2\n",
	},
	// A task's worktree starts from a commit, so the workspace needs one before the run (docs/08).
	commit: true,
	browserScript: {
		screenshots: [{ width: 1280, height: 720 }],
		audits: [LHR],
	},
	// The calls of the built-in web-dev team, in the order the engine makes them (docs/08).
	script: {
		turns: [
			say("Brief: one section with a heading."),
			APPROVE,
			calls(...SITE),
			call("shell_exec", { command: "npm run build" }),
			say("package.json, build.mjs, src/index.html, .gitignore"),
			APPROVE,
			call("shell_exec", { command: "npm run build" }),
			call("seo_audit", { folder: "dist" }),
			call("browser_screenshot", { folder: "dist" }),
			say("Build passed. Scores 97, 100, 100, 92; all at least 85."),
			APPROVE,
		],
	},
});

test("the web-dev team builds a page, merges it and audits the built folder", async ({
	mete,
}) => {
	const { page, dir } = mete;
	await runCommand(page, "METE: Start run");
	await page
		.getByLabel("What should METE do in this folder?")
		.fill("a one-page site that says hi");
	await page.getByRole("radio", { name: /Web development/ }).check();
	await page.getByRole("button", { name: "Start run", exact: true }).click();

	// The run ends after the lead approves the test report: the Team panel's strip says Done (docs/13).
	await expect(
		page.locator(".mete-chip").filter({ hasText: "Done" }).first(),
	).toBeVisible({ timeout: 240_000 });

	// The developer's files landed in the workspace through a merge commit named after its task;
	// dist stayed out of git, so the workspace has no build output of its own.
	for (const file of [
		"package.json",
		"build.mjs",
		"src/index.html",
		".gitignore",
	])
		expect(existsSync(join(dir, file)), file).toBe(true);
	expect(existsSync(join(dir, "dist"))).toBe(false);
});
