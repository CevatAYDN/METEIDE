import { describe, expect, it } from "vitest";
import { paintScene } from "../../src/domain/paint.js";
import {
	BOARD,
	DESK,
	MARK,
	PEOPLE,
	ROOM,
	SCREEN,
	WINDOW,
} from "../../src/domain/palette.js";
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
// Everything the room draws at a moment: the still layer, then the moving one above it.
const AT = { now: NOON, t: 0 };
const paint = (s: Scene) => {
	const room = paintScene(s, labels);
	return [...room.still, ...room.moving(AT)];
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
// A character's head is the only circle of radius 16.
const heads = (p: Primitive[]) =>
	p.flatMap((x) => (x.kind === "circle" && x.r === 16 ? [x] : []));

describe("the room's primitives", () => {
	it("starts with the floor, as wide and tall as the room, and writes the board's columns, a badge for hidden notes and the coffee sign", () => {
		const s = scene([], { todo: ["a", "b", "c", "d"], done: ["e"] });
		const p = paint(s);
		expect(p[0]).toMatchObject({ kind: "rect", x: 0, y: 0, w: 1280, h: 490 });
		expect(words(p)).toEqual(
			expect.arrayContaining(["To do", "In progress", "Done", "Coffee", "+1"]),
		);
		expect(words(p)).not.toContain("d");
	});

	it('pins a blocked task\'s note with a large red pin and a "!", and every other note with the small pin', () => {
		const s = scene([]);
		const room = paint({
			...s,
			notes: {
				...s.notes,
				in_progress: [
					{ id: "a", title: "a" },
					{ id: "b", title: "b", blocked: true },
				],
			},
		});
		const pins = room.flatMap((x) =>
			x.kind === "circle" && x.fill === BOARD.pin ? [x.r] : [],
		);
		expect(pins.filter((r) => r === 6)).toHaveLength(1);
		expect(pins.filter((r) => r === 2.8)).toHaveLength(1);
		expect(words(room)).toContain("!");
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
		const before = fill(paint(scene([], { todo: ["t1"] })));
		const after = fill(paint(scene([], { done: ["t1"] })));
		expect(before?.kind === "rect" && before.fill).toBe(
			after?.kind === "rect" && after.fill,
		);
	});

	it("draws a seated character between its chair and its desk, so the desk hides its body", () => {
		const p = paint(scene([[ch("dev", "idle")]]));
		const at = (fill: string) =>
			p.findIndex((x) => "fill" in x && x.fill === fill);
		const head = p.indexOf(heads(p)[0] as Primitive);
		expect(at(DESK.chair)).toBeLessThan(head);
		expect(head).toBeLessThan(at(DESK.top));
	});

	it("draws each character with its state's mark, its name, its tool and a count badge", () => {
		const s = scene([
			[
				ch("idle", "idle"),
				ch("think", "thinking"),
				ch("work", "working", { tool: "fs.read@1" }),
			],
			[ch("crowd", "idle", { count: 4 })],
		]);
		const p = paint(s);
		expect(heads(p)).toHaveLength(4);
		expect(
			p.filter((x) => x.kind === "circle" && x.fill === MARK.dots),
		).toHaveLength(3);
		expect(
			p.filter((x) => x.kind === "arc" && x.stroke === MARK.spinner),
		).toHaveLength(1);
		expect(words(p)).toEqual(
			expect.arrayContaining(["idle", "fs.read@1", "4", "crowd"]),
		);
	});

	it("wakes a monitor only while its character works, with the picture of its tool", () => {
		const lit = (p: Primitive[]) =>
			p.some((x) => x.kind === "rect" && x.fill === SCREEN.codeBg);
		const page = (p: Primitive[]) =>
			p.some((x) => x.kind === "rect" && x.fill === SCREEN.pageBg);
		const working = (tool: string) =>
			paint(scene([[ch("dev", "working", { tool })]]));
		expect(lit(working("fs.read@1"))).toBe(true);
		expect(page(working("web.search@1"))).toBe(true);
		expect(lit(paint(scene([[ch("dev", "idle")]])))).toBe(false);
		expect(lit(paint(scene([[ch("dev", "thinking")]])))).toBe(false);
	});

	it("shows the offline icon on every monitor and shades the whole room while offline, so a panel opened then draws it too", () => {
		const offline = (s: Scene): Scene => ({ ...s, offline: true });
		const rows = [
			[ch("dev", "working", { tool: "fs.read@1" }), ch("qa", "idle")],
		];
		const room = paintScene(offline(scene(rows)), labels);
		const icons = room.still.filter(
			(x) => x.kind === "line" && x.stroke === SCREEN.offlineSlash,
		);
		expect(icons).toHaveLength(2);
		expect(
			room.still.some((x) => x.kind === "rect" && x.fill === SCREEN.codeBg),
		).toBe(false);
		const floor = room.still[0];
		const top = room.moving(AT).at(-1);
		expect(top).toMatchObject({
			kind: "rect",
			fill: ROOM.offlineShade,
			x: 0,
			y: 0,
		});
		if (floor?.kind === "rect" && top?.kind === "rect")
			expect([top.w, top.h]).toEqual([floor.w, floor.h]);
		// No screensaver dot over the offline icon.
		expect(
			room
				.moving(AT)
				.some((x) => x.kind === "circle" && x.fill === SCREEN.sleepDot),
		).toBe(false);
		const online = paintScene(scene(rows), labels);
		expect(
			online
				.moving(AT)
				.some((x) => x.kind === "rect" && x.fill === ROOM.offlineShade),
		).toBe(false);
	});

	it("splits the room into a still layer and a moving one, which has no text and changes with the moment", () => {
		const room = paintScene(
			scene([
				[ch("dev", "thinking"), ch("qa", "working", { tool: "fs.read@1" })],
			]),
			labels,
		);
		const moving = room.moving(AT);
		// The window's sky, the clock's face, the eyes, the thinking dots and the spinner are all moving.
		expect(
			moving.some((x) => x.kind === "ellipse" && x.fill === PEOPLE.eye),
		).toBe(true);
		expect(
			moving.some((x) => x.kind === "circle" && x.fill === MARK.dots),
		).toBe(true);
		expect(
			moving.some((x) => x.kind === "arc" && x.stroke === MARK.spinner),
		).toBe(true);
		expect(
			moving.some((x) => x.kind === "rect" && x.fill === WINDOW.frame),
		).toBe(true);
		const kinds = new Set<string>(moving.map((x) => x.kind));
		expect(kinds.has("text") || kinds.has("label")).toBe(false);
		// None of it is in the still layer, which holds the room, the people's bodies and the words.
		const still = room.still;
		expect(
			still.some((x) => x.kind === "ellipse" && x.fill === PEOPLE.eye),
		).toBe(false);
		expect(still.some((x) => x.kind === "circle" && x.fill === MARK.dots)).toBe(
			false,
		);
		expect(
			still.some((x) => x.kind === "arc" && x.stroke === MARK.spinner),
		).toBe(false);
		expect(still[0]).toMatchObject({ kind: "rect", x: 0, y: 0, w: 1280 });
		// A later moment, or another time of day, draws another moving layer; the still one is the same.
		expect(room.moving({ now: NOON, t: 2 })).not.toEqual(moving);
		expect(
			room.moving({ now: new Date(2026, 9, 24, 23, 0), t: 0 }),
		).not.toEqual(moving);
	});

	it("writes every colour of the moving layer in a form Pixi reads, at every hour and moment", () => {
		const room = paintScene(
			scene([[ch("dev", "thinking"), ch("qa", "working")]]),
			labels,
		);
		const moments = Array.from({ length: 24 }, (_, h) => h).flatMap((h) =>
			[0, 0.37, 5, 123.456, 98765.4321].map((t) => ({
				now: new Date(2026, 9, 24, h, 17),
				t,
			})),
		);
		const colours = moments
			.flatMap((at) => room.moving(at))
			.flatMap((x) => [
				"fill" in x ? x.fill : "",
				"stroke" in x ? x.stroke : "",
			]);
		// Exponent notation (1.6e-9) and NaN make a colour Pixi throws on, and a throw ends its ticker.
		// An "e" in an rgba() string can only be an exponent; hex colours have their own e digits.
		const unreadable = (c: string) =>
			c.includes("NaN") ||
			c.includes("undefined") ||
			(c.startsWith("rgba(") && c.includes("e"));
		expect(colours.filter(unreadable)).toEqual([]);
	});

	it("sends a waiting character to the coffee corner, with its countdown, and leaves its desk empty", () => {
		const s = scene([
			[ch("artist", "waiting", { resetsAt: "2026-10-24T09:30:00.000Z" })],
		]);
		const p = paint(s);
		const [person] = heads(p);
		expect(person?.kind === "circle" && person.x).toBeGreaterThan(800);
		expect(p.some((x) => x.kind === "circle" && x.fill === MARK.clock)).toBe(
			true,
		);
		// After the last desk: nothing at the desk hides it.
		expect(p.indexOf(person as Primitive)).toBeGreaterThan(
			p.findLastIndex((x) => "fill" in x && x.fill === DESK.top),
		);
		expect(words(p)).toContain("until 09:30");
	});
});
