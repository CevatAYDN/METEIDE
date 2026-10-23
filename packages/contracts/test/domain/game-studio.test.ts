import { describe, expect, it } from "vitest";
import { artifactSchema } from "../../src/domain/artifacts.js";

// The game-studio artifact types of docs/08 (ADR-057).

const valid = (type: string, value: unknown) =>
	artifactSchema(type)?.safeParse(value).success;

const entry = (id: string, dependsOn?: string[]) => ({
	id,
	role: "developer",
	title: `build ${id}`,
	acceptance: ["it opens in a browser"],
	...(dependsOn ? { dependsOn } : {}),
});

describe("game-studio artifacts (ADR-057)", () => {
	it("knows a game design document and refuses one without mechanics or an unknown key", () => {
		const gdd = {
			title: "Pong",
			pitch: "Two paddles, one ball",
			mechanics: ["paddles move up and down"],
			scope: "no sound, no menus",
			acceptance: ["the ball bounces off the paddles"],
		};
		expect(valid("gdd@1", gdd)).toBe(true);
		expect(valid("gdd@1", { ...gdd, mechanics: [] })).toBe(false);
		expect(valid("gdd@1", { ...gdd, extra: 1 })).toBe(false);
	});

	it("knows a task list whose entries wait only for earlier ones", () => {
		expect(
			valid("task-list@1", {
				tasks: [entry("canvas"), entry("ball", ["canvas"])],
			}),
		).toBe(true);
		for (const tasks of [
			[],
			[entry("ball", ["canvas"]), entry("canvas")],
			[entry("ball", ["ball"])],
			[entry("canvas"), entry("canvas")],
			[{ ...entry("canvas"), role: "human" }],
			[{ ...entry("canvas"), id: "Canvas" }],
			[{ ...entry("canvas"), acceptance: [] }],
		])
			expect(valid("task-list@1", { tasks })).toBe(false);
	});

	it("knows asset specs, test reports and code changes", () => {
		expect(
			valid("asset-spec@1", {
				assets: [
					{
						name: "ball",
						description: "a white circle",
						path: "game/ball.svg",
					},
				],
			}),
		).toBe(true);
		expect(valid("asset-spec@1", { assets: [] })).toBe(false);
		const check = { name: "opens", passed: true, details: "the canvas draws" };
		expect(
			valid("test-report@1", { passed: true, checks: [check], gaps: [] }),
		).toBe(true);
		// passed is true only when every check passed.
		expect(
			valid("test-report@1", {
				passed: true,
				checks: [{ ...check, passed: false }],
				gaps: ["no game engine"],
			}),
		).toBe(false);
		expect(
			valid("code-change@1", {
				summary: "a canvas game",
				files: ["game/index.html"],
			}),
		).toBe(true);
		expect(valid("code-change@1", { summary: "nothing", files: [] })).toBe(
			false,
		);
		expect(artifactSchema("asset@1")).toBeUndefined();
	});
});
