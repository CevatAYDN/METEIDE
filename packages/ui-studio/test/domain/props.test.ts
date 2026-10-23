import { describe, expect, it } from "vitest";
import { SHELF, WINDOW } from "../../src/domain/palette.js";
import type { Primitive } from "../../src/domain/primitive.js";
import { clockOf, plantOf, shelfOf, windowOf } from "../../src/domain/props.js";
import { skyOf } from "../../src/domain/sky.js";

// The wall's props: the window with the user's time of day, the clock, the Vault shelf and the plants
// (docs/13, Scene layout; ADR-070), as primitives.

const at = (hour: number, minute = 0) => new Date(2026, 9, 24, hour, minute);
const words = (p: Primitive[]) =>
	p.flatMap((x) => (x.kind === "text" || x.kind === "label" ? [x.text] : []));
const lines = (p: Primitive[]) =>
	p.flatMap((x) => (x.kind === "line" ? [x] : []));

// The window's pane is 212 wide, 112 high, from (564, 34).
const PANE = { x: 564, y: 34, w: 212, h: 112 };
const inPane = (p: Primitive) => {
	if (p.kind === "circle")
		return (
			p.x - p.r >= PANE.x &&
			p.x + p.r <= PANE.x + PANE.w &&
			p.y - p.r >= PANE.y &&
			p.y + p.r <= PANE.y + PANE.h
		);
	return true;
};
const circles = (p: Primitive[], fill: RegExp) =>
	p.flatMap((x) => (x.kind === "circle" && fill.test(x.fill) ? [x] : []));

describe("windowOf", () => {
	const day = windowOf(skyOf(at(14)));
	const night = windowOf(skyOf(at(23)));

	it("shows the sun, clouds and no stars, moon or lit windows by day", () => {
		expect(circles(day, /^rgba\(255,238,178/).length).toBe(1);
		expect(circles(night, /^rgba\(255,238,178/)).toEqual([]);
		expect(circles(day, /^rgba\(246,243,226/)).toEqual([]);
		const stars = (p: Primitive[]) =>
			p.filter((x) => x.kind === "rect" && x.w === 1.7).length;
		expect(stars(day)).toBe(0);
		expect(stars(night)).toBeGreaterThan(10);
		const lit = (p: Primitive[]) =>
			p.filter(
				(x) => x.kind === "rect" && x.fill.startsWith("rgba(255,214,120"),
			).length;
		expect(lit(day)).toBe(0);
		expect(lit(night)).toBeGreaterThan(5);
	});

	it("shows the moon at night, and the sky darker than by day", () => {
		expect(circles(night, /^rgba\(246,243,226/).length).toBe(1);
		const bands = (p: Primitive[]) =>
			p.flatMap((x) =>
				x.kind === "rect" && x.w === PANE.w && x.h === PANE.h / 8
					? [x.fill]
					: [],
			);
		expect(bands(day)).toHaveLength(8);
		expect(bands(night)).toHaveLength(8);
		expect(bands(day)[0]).not.toBe(bands(night)[0]);
	});

	it("keeps the sun and the moon inside the pane at every hour", () => {
		for (let h = 0; h < 24; h++)
			for (const p of windowOf(skyOf(at(h, 30))))
				expect(inPane(p), `${h}:30`).toBe(true);
	});

	it("draws the frame, the mullions and the sill with its plant over the sky", () => {
		const first = day[0];
		expect(first).toMatchObject({ kind: "rect", fill: WINDOW.frame });
		expect(day.at(-1)).toMatchObject({ kind: "ellipse", fill: WINDOW.sprout });
	});
});

describe("clockOf", () => {
	const hands = (h: number, m: number) => lines(clockOf(at(h, m))).slice(-2);

	it("points the hour hand right at 3:00 and up at 12:00", () => {
		const [hour] = hands(3, 0);
		expect(hour?.x2).toBeCloseTo(505 + 10, 6);
		expect(hour?.y2).toBeCloseTo(74, 6);
		const [twelve] = hands(12, 0);
		expect(twelve?.x2).toBeCloseTo(505, 6);
		expect(twelve?.y2).toBeCloseTo(74 - 10, 6);
	});

	it("points the minute hand down at :30 and moves the hour hand with the minutes", () => {
		const [, minute] = hands(6, 30);
		expect(minute?.x2).toBeCloseTo(505, 6);
		expect(minute?.y2).toBeCloseTo(74 + 15, 6);
		const [early] = hands(3, 0);
		const [late] = hands(3, 30);
		expect(late?.y2).toBeGreaterThan(early?.y2 ?? 0);
	});

	it("draws a face with twelve ticks", () => {
		const ticks = clockOf(at(10, 10)).filter(
			(x) => x.kind === "rect" && x.w === 2 && x.h === 2,
		);
		expect(ticks).toHaveLength(12);
	});
});

describe("shelfOf", () => {
	it("writes the Vault sign and stands the seeded books on two boards", () => {
		const p = shelfOf("Vault");
		expect(words(p)).toEqual(["Vault"]);
		const books = p.filter((x) => x.kind === "rect" && x.w === 11);
		expect(books).toHaveLength(13);
		const boards = p.filter(
			(x) => x.kind === "rect" && x.h === 5 && x.fill === SHELF.frame,
		);
		expect(boards).toHaveLength(3);
		// Every book stands on a board: its bottom is a board's top.
		const tops = new Set(boards.map((b) => (b.kind === "rect" ? b.y : 0)));
		for (const b of books)
			if (b.kind === "rect") expect(tops.has(b.y + b.h)).toBe(true);
	});
});

describe("plantOf", () => {
	it("draws a pot and seven leaves that fan out above it, bigger with the scale", () => {
		const small = plantOf({ x: 100, base: 200, scale: 1 });
		const big = plantOf({ x: 100, base: 200, scale: 2 });
		for (const p of [small, big])
			expect(p.filter((x) => x.kind === "poly")).toHaveLength(8);
		const top = (p: Primitive[]) =>
			Math.min(
				...p.flatMap((x) =>
					x.kind === "poly" ? x.points.filter((_, i) => i % 2) : [],
				),
			);
		expect(top(small)).toBeLessThan(200 - 30);
		expect(top(big)).toBeLessThan(top(small));
	});
});
