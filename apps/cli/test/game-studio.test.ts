import { access, writeFile } from "node:fs/promises";
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

// The built-in game-studio template through every real module but the models and the browser
// (docs/08, ADR-057): the design waits for the lead and the human, the project manager's task list
// becomes tasks, the developer's game lands in the workspace, and the tester screenshots it.

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
const APPROVE = say('{"decision":"approve"}');

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
const PNG = Buffer.from("89504e470d0a1a0a", "hex");

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

describe("the game-studio template", () => {
	it("turns an idea into an approved design, spawned tasks and a game in the workspace", async () => {
		const repo = await tempRepo({ "README.md": "# game\n" });
		const script = [
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
			// The tester reviews the developer's game as its pair before the lead (ADR-136).
			APPROVE,
			APPROVE,
			calls(["browser_screenshot", { folder: "game" }]),
			say(REPORT),
			APPROVE,
		];
		const shot: unknown[] = [];
		const browser: Pick<BrowserOptions, "run" | "chromium"> = {
			run: async (req) => {
				shot.push(req.target);
				await writeFile(req.out, PNG);
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
		const goal = "a tiny game where you click a moving dot";
		expect(
			await runCommand(app.value, t.io, { goal, templateId: "game-studio" }),
		).toBe(2);
		expect(t.out).toContain(
			"waiting for human: Write the game design document",
		);
		const runId = /^run (\S+) started$/.exec(t.out[0] ?? "")?.[1] ?? "";
		const after = recordingIo();
		const input = { decision: "approve" as const };
		expect(
			await runCommand(app.value, after.io, { approve: runId, input }),
		).toBe(0);

		// The spawned tasks were announced after the template's two, and the developer's game landed.
		const events = runHistory(app.value.registry, runId)?.events ?? [];
		const created = events.filter((e) => e.type === "task.created");
		expect(created.map((e) => e.payload.title)).toEqual([
			"Write the game design document",
			"Split the design into tasks",
			"Build the dot game",
			"Check the dot game",
		]);
		expect(await exists(join(repo.workspaceDir, "game", "index.html"))).toBe(
			true,
		);
		// The tester screenshotted the game folder of its own worktree.
		expect(shot).toHaveLength(1);
		expect((shot[0] as { folder: string }).folder.endsWith("game")).toBe(true);
		expect(events.map((e) => e.type)).toContain("run.completed");
		const reviews = events.filter((e) => e.type === "review.completed");
		expect(reviews.map((e) => e.payload)).toEqual([
			{ reviewerRoleId: "tester", decision: "approve" },
		]);
	}, 180_000);
});
