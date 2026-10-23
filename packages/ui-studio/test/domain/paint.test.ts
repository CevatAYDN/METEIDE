import { describe, expect, it } from "vitest";
import { paintScene } from "../../src/domain/paint.js";
import { DESK, STATE } from "../../src/domain/palette.js";
import type { Primitive } from "../../src/domain/primitive.js";
import type { Character, Scene } from "../../src/domain/scene.js";

// The room's primitives for scenes written by hand: what is drawn where, in which order and colour.

// Local noon: the window shows a day sky, whatever the machine's zone.
const NOON = new Date(2026, 9, 24, 12, 0);
const labels = {
	todo: "To do",
	inProgress: "In progress",
	done: "Done",
	coffee: "Coffee",
	vault: "Vault",
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
const words = (p: Primitive[]) =>
	p.flatMap((x) => (x.kind === "text" || x.kind === "label" ? [x.text] : []));
const bodies = (p: Primitive[]) =>
	p.flatMap((x) => (x.kind === "circle" && x.r === 16 ? [x] : []));

describe("the room's primitives", () => {
	it("starts with the floor, as wide and tall as the room, and writes the board's columns, a badge for hidden notes and the coffee sign", () => {
		const s = scene([], { todo: ["a", "b", "c", "d"], done: ["e"] });
		const p = paintScene(s, labels, NOON);
		expect(p[0]).toMatchObject({ kind: "rect", x: 0, y: 0, w: 1280, h: 490 });
		expect(words(p)).toEqual(
			expect.arrayContaining(["To do", "In progress", "Done", "Coffee", "+1"]),
		);
		expect(words(p)).not.toContain("d");
	});

	it("keeps a note's colour when its task moves to another column", () => {
		const fill = (p: Primitive[]) =>
			p.find(
				(x) =>
					x.kind === "rect" &&
					x.w === 104 &&
					x.r === 3 &&
					!x.fill.startsWith("rgba"),
			);
		const before = fill(paintScene(scene([], { todo: ["t1"] }), labels, NOON));
		const after = fill(paintScene(scene([], { done: ["t1"] }), labels, NOON));
		expect(before?.kind === "rect" && before.fill).toBe(
			after?.kind === "rect" && after.fill,
		);
	});

	it("draws a seated character between its chair and its desk, so the desk hides its body", () => {
		const p = paintScene(scene([[ch("dev", "idle")]]), labels, NOON);
		const at = (fill: string) =>
			p.findIndex((x) => "fill" in x && x.fill === fill);
		const body = p.indexOf(bodies(p)[0] as Primitive);
		expect(at(DESK.chair)).toBeLessThan(body);
		expect(body).toBeLessThan(at(DESK.top));
	});

	it("colours each character by its state, with its name, thinking dots, its tool and a count badge", () => {
		const s = scene([
			[
				ch("idle", "idle"),
				ch("think", "thinking"),
				ch("work", "working", { tool: "fs.read@1" }),
			],
			[ch("crowd", "idle", { count: 4 })],
		]);
		const p = paintScene(s, labels, NOON);
		expect(bodies(p).map((x) => x.kind === "circle" && x.fill)).toEqual([
			STATE.idle,
			STATE.thinking,
			STATE.working,
			STATE.idle,
		]);
		expect(p.filter((x) => x.kind === "circle" && x.r === 2.5)).toHaveLength(3);
		expect(words(p)).toEqual(
			expect.arrayContaining(["idle", "fs.read@1", "4", "crowd"]),
		);
	});

	it("sends a waiting character to the coffee corner, with its countdown, and leaves its desk empty", () => {
		const s = scene([
			[ch("artist", "waiting", { resetsAt: "2026-10-24T09:30:00.000Z" })],
		]);
		const p = paintScene(s, labels, NOON);
		const [person] = bodies(p);
		expect(person?.kind === "circle" && person.x).toBeGreaterThan(800);
		expect(person?.kind === "circle" && person.fill).toBe(STATE.waiting);
		// After the last desk: nothing at the desk hides it.
		expect(p.indexOf(person as Primitive)).toBeGreaterThan(
			p.findLastIndex((x) => "fill" in x && x.fill === DESK.top),
		);
		expect(words(p)).toContain("until 09:30");
	});
});
