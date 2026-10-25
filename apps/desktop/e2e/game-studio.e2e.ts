import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	artifactPath,
	expect,
	inboxLink,
	runCommand,
	startRun,
	test,
} from "./launch.js";

// The fourth built-in template in the desktop app (ROADMAP.md; docs/15): the design waits for the
// human as well as the lead, the project manager's task list becomes spawned tasks, the developer
// builds the game in a worktree that merges into the workspace, and the tester screenshots the
// merged folder and reports the gap a missing `gameengine.test@1` adapter leaves. The models and the
// screenshot are the test's scripts (ADR-111, ADR-117); the daemon, the engine, git, the tools and
// the panels are real. What the run cannot prove is the game's play: no capability plays one and the
// tester must report that gap (docs/06, docs/08), so the gate's "a prototype that plays" still rests
// on the human.

const GOAL = "a tiny game where you click a moving dot";

const GDD = JSON.stringify({
	title: "Click the dot",
	pitch: "A dot jumps around; click it to score.",
	mechanics: [
		"the dot moves every second",
		"a click on the dot scores a point",
	],
	scope: "no sound, no levels",
	acceptance: ["game/index.html shows the dot and the score"],
});

const TASKS = JSON.stringify({
	tasks: [
		{
			id: "build_game",
			role: "developer",
			title: "Build the dot game",
			acceptance: ["the dot moves and a click scores"],
		},
		{
			id: "check_game",
			role: "tester",
			title: "Check the dot game",
			acceptance: ["every acceptance sentence of the design holds"],
			dependsOn: ["build_game"],
		},
	],
});

const REPORT = JSON.stringify({
	passed: true,
	checks: [
		{ name: "page", passed: true, details: "the dot and the score show" },
	],
	gaps: ["no game engine: play was checked by reading the code"],
});

const finish = (reason: "stop" | "tool-calls") => ({
	type: "finish",
	reason,
	usage: { prompt: 10, completion: 5 },
});
const say = (text: string) => [{ type: "text", text }, finish("stop")];
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
	// A task's worktree starts from a commit (docs/08), and the workspace needs one file to commit.
	files: { "README.md": "# game\n" },
	commit: true,
	browserScript: { screenshots: [{ width: 1280, height: 720 }] },
	// The built-in team's calls in the order the engine makes them (docs/08, ADR-057).
	script: {
		turns: [
			say(GDD),
			APPROVE,
			say(TASKS),
			APPROVE,
			calls(
				[
					"fs_write",
					{
						path: "game/index.html",
						content:
							'<!doctype html><title>Dot</title><script src="game.js"></script>\n',
					},
				],
				["fs_write", { path: "game/game.js", content: "let score = 0;\n" }],
			),
			say("game/index.html, game/game.js"),
			APPROVE,
			calls(["browser_screenshot", { folder: "game" }]),
			say(REPORT),
			APPROVE,
		],
	},
});

test("the game studio turns an idea into an approved design, spawned tasks and a game", async ({
	mete,
}) => {
	const { page, dir } = mete;
	await startRun(page, { goal: GOAL, team: /Game studio/ });

	// The design's own approval waits for the lead and then for the human (docs/08).
	const design = /asks you to approve “Write the game design document”/;
	await expect(page.getByText(design)).toBeVisible({ timeout: 120_000 });
	await runCommand(page, "METE: Show what waits for you");
	await expect(inboxLink(page, GOAL)).toBeVisible({ timeout: 60_000 });
	await inboxLink(page, GOAL).click();
	await page
		.locator(".mete-panel")
		.filter({ hasText: design })
		.getByRole("button", { name: "Approve" })
		.click();

	// The spawned tasks run one at a time and the run ends once the lead approves the test report.
	await expect(
		page.locator('section[aria-label="Runs"]').getByText("Done"),
	).toBeVisible({ timeout: 240_000 });

	// The developer's game merged from its worktree into the workspace.
	for (const file of ["game/index.html", "game/game.js"])
		expect(existsSync(join(dir, file)), file).toBe(true);

	// The tester's report is its artifact, and it names the gap the missing adapter leaves.
	const report = artifactPath(dir, "check_game.md");
	expect(report).toBeDefined();
	expect(readFileSync(report ?? "", "utf8")).toContain("no game engine");

	// Its screenshot of the merged folder is the image the tool measured.
	const assets = join(dir, ".mete", "assets");
	const png = readdirSync(assets).find((name) => name.endsWith(".png")) ?? "";
	const bytes = readFileSync(join(assets, png));
	expect(bytes.readUInt32BE(16)).toBe(1280);
	expect(bytes.readUInt32BE(20)).toBe(720);
});
