import { describe, expect, it } from "vitest";
import { marksOf } from "../../src/domain/marks.js";
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

	it("shows thinking as a bubble with three dots at the head's right", () => {
		const p = marksOf(ch("thinking"), HEAD);
		const dots = p.filter((x) => x.kind === "circle" && x.r === 2.4);
		expect(dots).toHaveLength(3);
		for (const d of dots)
			expect(d).toMatchObject({ y: HEAD.y - 14, fill: MARK.dots });
		expect(p.some((x) => x.kind === "rect" && x.fill === MARK.bubble)).toBe(
			true,
		);
	});

	it("shows working as a spinner arc and names the tool above", () => {
		const p = marksOf(ch("working", { tool: "fs.read@1" }), HEAD);
		const spin = p.find((x) => x.kind === "arc");
		expect(spin).toMatchObject({
			x: HEAD.x + 30,
			y: HEAD.y - 14,
			stroke: MARK.spinner,
		});
		expect(spin?.kind === "arc" && spin.end - spin.start).toBeCloseTo(
			Math.PI * 1.3,
			6,
		);
		expect(words(p)).toEqual(["dev", "fs.read@1"]);
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
