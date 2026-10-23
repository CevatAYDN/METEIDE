import { describe, expect, it } from "vitest";
import { marksMotion, marksOf } from "../../src/domain/marks.js";
import { MARK } from "../../src/domain/palette.js";
import type { Primitive } from "../../src/domain/primitive.js";
import type { Character } from "../../src/domain/scene.js";

// What a state adds over a character (docs/13): name, count badge, state icon, tool and countdown.

const HEAD = { x: 300, y: 200 };
const ch = (
	state: Character["state"],
	more: Partial<Character> = {},
): Character => ({ id: "a", roleId: "dev", count: 1, state, ...more });
const words = (p: Primitive[]) =>
	p.flatMap((x) => (x.kind === "label" || x.kind === "text" ? [x.text] : []));

describe("marksOf", () => {
	it("names an idle character and adds nothing else", () => {
		const p = marksOf(ch("idle"), HEAD);
		expect(words(p)).toEqual(["dev"]);
		expect(p).toHaveLength(1);
	});

	it("shows thinking as a bubble at the head's right, and working with only its tool named above", () => {
		const bubble = marksOf(ch("thinking"), HEAD);
		expect(
			bubble.some((x) => x.kind === "rect" && x.fill === MARK.bubble),
		).toBe(true);
		expect(bubble.some((x) => x.kind === "circle")).toBe(false);
		const working = marksOf(ch("working", { tool: "fs.read@1" }), HEAD);
		expect(words(working)).toEqual(["dev", "fs.read@1"]);
		expect(working.some((x) => x.kind === "arc")).toBe(false);
		expect(words(marksOf(ch("working"), HEAD))).toEqual(["dev"]);
	});

	it("shows waiting as a clock with its countdown, and no countdown without one", () => {
		const p = marksOf(ch("waiting"), HEAD, "until 09:30");
		expect(
			p.some((x) => x.kind === "circle" && x.r === 10 && x.fill === MARK.clock),
		).toBe(true);
		expect(p.filter((x) => x.kind === "line")).toHaveLength(2);
		expect(words(p)).toEqual(["dev", "until 09:30"]);
		expect(words(marksOf(ch("waiting"), HEAD))).toEqual(["dev"]);
	});

	it("badges a group with its size", () => {
		expect(words(marksOf(ch("idle", { count: 4 }), HEAD))).toEqual([
			"dev",
			"4",
		]);
		expect(words(marksOf(ch("idle", { count: 1 }), HEAD))).toEqual(["dev"]);
	});
});

describe("marksMotion", () => {
	it("rides three dots on a wave in the thinking bubble", () => {
		const dots = (t: number) => marksMotion(ch("thinking"), HEAD, t);
		expect(dots(0)).toHaveLength(3);
		for (const d of dots(0))
			expect(d).toMatchObject({ kind: "circle", r: 2.4, fill: MARK.dots });
		const ys = (t: number) =>
			dots(t).map((d) => (d.kind === "circle" ? d.y : 0));
		expect(ys(0)).not.toEqual(ys(0.3));
		for (const y of ys(0.7))
			expect(Math.abs(y - (HEAD.y - 14))).toBeLessThanOrEqual(2.5);
	});

	it("turns the working spinner a 1.3 turn arc at the head's right", () => {
		const spin = (t: number) => marksMotion(ch("working"), HEAD, t)[0];
		const a = spin(0);
		const b = spin(0.5);
		expect(a).toMatchObject({
			kind: "arc",
			x: HEAD.x + 30,
			y: HEAD.y - 14,
			stroke: MARK.spinner,
		});
		expect(a?.kind === "arc" && a.end - a.start).toBeCloseTo(Math.PI * 1.3, 6);
		expect(a).not.toEqual(b);
	});

	it("moves nothing for the others", () => {
		for (const state of ["idle", "waiting"] as const)
			expect(marksMotion(ch(state), HEAD, 1)).toEqual([]);
	});
});
