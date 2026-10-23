import { TOKENS } from "@mete/ui-kit";
import { describe, expect, it } from "vitest";
import {
	effectColours,
	type Primitive,
	paintScene,
} from "../../src/domain/paint.js";
import type { Character, Scene } from "../../src/domain/scene.js";

// The room's primitives for scenes written by hand: what is drawn where, and in which colours.

const labels = {
	todo: "To do",
	inProgress: "In progress",
	done: "Done",
	coffee: "Coffee",
	until: (at: string) => `until ${at.slice(11, 16)}`,
};
const ch = (
	id: string,
	state: Character["state"],
	more: Partial<Character> = {},
): Character => ({
	id,
	roleId: id,
	count: 1,
	state,
	...more,
});
const scene = (
	rows: Character[][],
	titles: Partial<Record<keyof Scene["notes"], string[]>> = {},
): Scene => {
	const notes = (ids: string[] = []) => ids.map((id) => ({ id, title: id }));
	return {
		rows,
		notes: {
			todo: notes(titles.todo),
			in_progress: notes(titles.in_progress),
			done: notes(titles.done),
		},
	};
};
const texts = (p: Primitive[]) =>
	p.flatMap((x) => (x.kind === "text" ? [x.text] : []));
const circles = (p: Primitive[]) => p.filter((x) => x.kind === "circle");

describe("the room's primitives", () => {
	it("paints the background and the board in the theme's colours, with each column's count", () => {
		const s = scene([], { todo: ["a", "b"], done: ["c"] });
		const light = paintScene(s, "light", 900, labels);
		const dark = paintScene(s, "dark", 900, labels);
		expect(light[0]).toMatchObject({
			kind: "rect",
			x: 0,
			y: 0,
			w: 900,
			fill: TOKENS.light.bg,
		});
		expect(dark[0]).toMatchObject({ fill: TOKENS.dark.bg });
		expect(texts(light)).toEqual(
			expect.arrayContaining([
				"To do (2)",
				"In progress (0)",
				"Done (1)",
				"Coffee",
			]),
		);
	});

	it("colours each character by its state, with thinking dots, a tool label and a count badge", () => {
		const s = scene([
			[
				ch("idle", "idle"),
				ch("think", "thinking"),
				ch("work", "working", { tool: "fs.read@1" }),
			],
			[ch("crowd", "idle", { count: 4 })],
		]);
		const p = paintScene(s, "light", 900, labels);
		const big = circles(p).filter((x) => x.kind === "circle" && x.r === 16);
		expect(big.map((x) => x.kind === "circle" && x.fill)).toEqual([
			TOKENS.light.muted,
			TOKENS.light.accent,
			TOKENS.light.good,
			TOKENS.light.muted,
		]);
		expect(
			circles(p).filter((x) => x.kind === "circle" && x.r === 2.5),
		).toHaveLength(3);
		expect(texts(p)).toEqual(
			expect.arrayContaining(["fs.read@1", "4", "crowd"]),
		);
	});

	it("sends a waiting character to the coffee corner, with its countdown, and leaves its desk empty", () => {
		const s = scene([
			[ch("artist", "waiting", { resetsAt: "2026-10-24T09:30:00.000Z" })],
		]);
		const p = paintScene(s, "dark", 900, labels);
		const person = circles(p).find((x) => x.kind === "circle" && x.r === 16);
		expect(person && person.kind === "circle" && person.x).toBeGreaterThan(
			900 - 170 - 16,
		);
		expect(person && person.kind === "circle" && person.fill).toBe(
			TOKENS.dark.warn,
		);
		expect(texts(p)).toContain("until 09:30");
	});

	it("gives each effect colour its token in the theme's mode", () => {
		expect(effectColours("dark")).toEqual({
			good: TOKENS.dark.good,
			accent: TOKENS.dark.accent,
			warn: TOKENS.dark.warn,
			bad: TOKENS.dark.bad,
		});
	});

	it("grows the room with its rows", () => {
		const one = paintScene(scene([[ch("a", "idle")]]), "light", 900, labels);
		const two = paintScene(
			scene([[ch("a", "idle")], [ch("b", "idle")]]),
			"light",
			900,
			labels,
		);
		const h = (p: Primitive[]) => (p[0]?.kind === "rect" ? p[0].h : 0);
		expect(h(two)).toBeGreaterThan(h(one));
	});
});
