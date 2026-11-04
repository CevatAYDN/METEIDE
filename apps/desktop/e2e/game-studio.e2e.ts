import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { FrameLocator, Page } from "@playwright/test";
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
	passed: false,
	checks: [
		{ name: "page", passed: true, details: "the dot and the score show" },
		{ name: "play", passed: false, details: "not independently verified" },
	],
	gaps: ["the scripted tester did not play the game"],
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

const GAME_PAGE = `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Catch the dot</title>
<style>
  :root { color-scheme: dark; font: 18px system-ui, sans-serif; background: #17162a; color: #eceaf7; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; }
  main { width: min(90vw, 680px); }
  #playfield { position: relative; height: 380px; margin-top: 20px; border: 2px solid #625bb1; border-radius: 16px; background: #211f38; overflow: hidden; }
  #dot { position: absolute; width: 56px; height: 56px; border: 0; border-radius: 50%; background: #f0b75a; cursor: pointer; }
  #dot:focus-visible, #restart:focus-visible { outline: 3px solid #fff; outline-offset: 3px; }
</style>
<main><h1>Catch the dot</h1><p role="status" aria-live="polite">Score: 0 · Time: 30</p><p id="result" role="alert"></p><div id="playfield"><button id="dot" aria-label="Catch the dot"></button></div><button id="restart">Play again</button></main>
<script src="game.js"></script></html>`;

const GAME_SCRIPT = `const dot=document.querySelector('#dot'),scoreText=document.querySelector('[role=status]'),result=document.querySelector('#result'),field=document.querySelector('#playfield');let score=0,time=30,active=true;const place=()=>{dot.style.left=Math.floor(Math.random()*(field.clientWidth-56))+'px';dot.style.top=Math.floor(Math.random()*(field.clientHeight-56))+'px';};const update=()=>scoreText.textContent='Score: '+score+' · Time: '+time;const finish=won=>{active=false;dot.disabled=true;result.textContent=won?'You win!':'Time is up!';clearInterval(mover);clearInterval(clock);};const mover=setInterval(()=>{if(active)place();},250);const clock=setInterval(()=>{if(!active)return;time--;update();if(time<=0)finish(false);},1000);dot.addEventListener('click',()=>{if(!active)return;score++;update();if(score===3)finish(true);else place();});document.querySelector('#restart').addEventListener('click',()=>location.reload());place();`;

const playAndWin = async (game: FrameLocator) => {
	const dot = game.getByRole("button", { name: "Catch the dot" });
	await expect(dot).toBeVisible();
	await expect(game.getByRole("status")).toContainText("Score: 0");
	const before = await dot.getAttribute("style");
	await expect.poll(() => dot.getAttribute("style")).not.toBe(before);
	for (const score of [1, 2, 3]) {
		await dot.click();
		await expect(game.getByRole("status")).toContainText(`Score: ${score}`);
	}
	await expect(game.getByRole("alert")).toHaveText("You win!");
	await expect(dot).toBeDisabled();
	await game.getByRole("button", { name: "Play again" }).click();
	await expect(game.getByRole("status")).toContainText("Score: 0");
};

const playAndLose = async (game: FrameLocator) => {
	await expect(game.getByRole("alert")).toHaveText("Time is up!", {
		timeout: 32_000,
	});
	await expect(
		game.getByRole("button", { name: "Catch the dot" }),
	).toBeDisabled();
};

const showGame = async (page: Page, url: string) => {
	await page.evaluate((src) => {
		const frame = document.createElement("iframe");
		frame.id = "mete-game-live-test";
		frame.title = "Live Game Studio play test";
		frame.src = src;
		Object.assign(frame.style, {
			position: "fixed",
			top: "8vh",
			left: "12vw",
			width: "76vw",
			height: "84vh",
			zIndex: "2147483647",
			border: "3px solid #8f83f2",
			borderRadius: "12px",
			background: "#17162a",
		});
		document.body.append(frame);
	}, url);
	return page.frameLocator("#mete-game-live-test");
};

test.use({
	// A task's worktree starts from a commit (docs/08), and the workspace needs one file to commit.
	files: { "README.md": "# game\n" },
	commit: true,
	browserScript: { screenshots: [{ width: 1280, height: 720 }] },
	// The built-in team's calls in the order the engine makes them (docs/08, ADR-057).
	script: {
		turns: [
			// The designer asks the human before it writes (ADR-142) and has no questions.
			say("none"),
			say(GDD),
			APPROVE,
			say(TASKS),
			APPROVE,
			calls(
				["fs_write", { path: "game/index.html", content: GAME_PAGE }],
				["fs_write", { path: "game/game.js", content: GAME_SCRIPT }],
			),
			say("game/index.html, game/game.js"),
			// The tester reviews the developer's game as its pair before the lead (ADR-136).
			APPROVE,
			APPROVE,
			calls(["browser_screenshot", { folder: "game" }]),
			say(REPORT),
			APPROVE,
		],
	},
});

const screenshotIsValid = (dir: string) => {
	const assets = join(dir, ".mete", "assets");
	const png = readdirSync(assets).find((name) => name.endsWith(".png")) ?? "";
	const bytes = readFileSync(join(assets, png));
	expect(bytes.readUInt32BE(16)).toBe(1280);
	expect(bytes.readUInt32BE(20)).toBe(720);
};

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
	const game = await showGame(
		page,
		pathToFileURL(join(dir, "game/index.html")).href,
	);

	// The scripted tester must not claim play evidence it did not gather.
	const report = artifactPath(dir, "check_game.md");
	expect(report).toBeDefined();
	const reportText = readFileSync(report ?? "", "utf8");
	expect(reportText).toContain("not independently verified");
	expect(reportText).toContain("did not play the game");
	expect(reportText).not.toContain('"passed": true');

	// Its screenshot of the merged folder is the image the tool measured.
	screenshotIsValid(dir);
	await playAndWin(game);
	await playAndLose(game);
});
