import { describe, expect, it } from "vitest";
import type { Effect } from "../../src/domain/effects.js";
import { MAX_PARTICLES, motionsOf } from "../../src/domain/motion.js";

// The motions the stage plays for effects: particles capped, reduced motion honoured.

const colours = { good: "#0f0", accent: "#00f", warn: "#fa0", bad: "#f00" };
const at = { x: 100, y: 100 };
const effects: Effect[] = [
	{ kind: "burst", at, colour: "good" },
	{ kind: "mark", at, text: "!", colour: "warn" },
	{ kind: "move", target: "envelope", from: at, to: { x: 200, y: 50 } },
	{ kind: "jump", at: [at] },
];

describe("the stage's motions", () => {
	it("plays a burst as twelve particles that fade outwards, and the other effects once each", () => {
		const m = motionsOf(effects, colours, false, 0);
		expect(m.filter((x) => x.particle)).toHaveLength(12);
		expect(m.filter((x) => !x.particle).map((x) => x.shape.kind)).toEqual([
			"text",
			"dot",
			"dot",
		]);
		const envelope = m.find((x) => x.shape.kind === "dot" && x.shape.r === 6);
		expect(envelope?.to).toEqual({ x: 200, y: 50 });
		expect(m.find((x) => x.particle)?.to.alpha).toBe(0);
	});

	it("never lets more than 300 particles live at once", () => {
		expect(
			motionsOf(effects, colours, false, MAX_PARTICLES - 5).filter(
				(x) => x.particle,
			),
		).toHaveLength(5);
		expect(
			motionsOf(effects, colours, false, MAX_PARTICLES).filter(
				(x) => x.particle,
			),
		).toHaveLength(0);
	});

	it("keeps only marks, fading in place, under reduced motion", () => {
		const m = motionsOf(effects, colours, true, 0);
		expect(m).toHaveLength(1);
		expect(m[0]?.shape).toEqual({ kind: "text", text: "!", colour: "#fa0" });
		expect(m[0]?.to.y).toBe(m[0]?.from.y);
	});
});
