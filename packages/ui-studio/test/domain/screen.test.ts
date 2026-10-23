import { describe, expect, it } from "vitest";
import { SCREEN } from "../../src/domain/palette.js";
import type { Primitive } from "../../src/domain/primitive.js";
import { screenKindOf, screenOf, sleepDot } from "../../src/domain/screen.js";

// What a monitor shows for the tool its character works with (docs/13, the agent.tool.called row).

const BOX = { x: 100, y: 200 };
const first = (p: Primitive[]) => (p[0] && "fill" in p[0] ? p[0].fill : "");

describe("screenKindOf", () => {
	it("picks code for files, a results page for the web, a painting for media and test rows for tests", () => {
		expect(screenKindOf("fs.read@1")).toBe("code");
		expect(screenKindOf("fs.write@1")).toBe("code");
		expect(screenKindOf("web.search@1")).toBe("search");
		expect(screenKindOf("web.fetch@1")).toBe("search");
		expect(screenKindOf("media.image.generate@1")).toBe("paint");
		expect(screenKindOf("gameengine.test@1")).toBe("test");
		expect(screenKindOf("verify.run@1")).toBe("test");
	});

	it("shows code for any other tool and for none, so a working agent's monitor is lit", () => {
		expect(screenKindOf("shell.exec@1")).toBe("code");
		expect(screenKindOf("vcs.git@2")).toBe("code");
		expect(screenKindOf(undefined)).toBe("code");
	});
});

describe("screenOf", () => {
	it("starts each picture with its own background over the whole screen", () => {
		const bg = (tool: string) => first(screenOf(tool, BOX));
		expect(bg("fs.read@1")).toBe(SCREEN.codeBg);
		expect(bg("web.search@1")).toBe(SCREEN.pageBg);
		expect(bg("media.image.generate@1")).toBe(SCREEN.paintBg);
		// Test rows share the dark editor background but have rows, not code lines.
		expect(bg("gameengine.test@1")).toBe(SCREEN.codeBg);
		expect(screenOf("gameengine.test@1", BOX)).not.toEqual(
			screenOf("fs.read@1", BOX),
		);
		expect(screenOf("fs.read@1", BOX)[0]).toMatchObject({
			x: 100,
			y: 200,
			w: 54,
			h: 36,
		});
	});

	it("draws nothing outside the 54 by 36 screen, for every picture", () => {
		const inside = (p: Primitive) => {
			if (p.kind === "rect")
				return (
					p.x >= BOX.x &&
					p.y >= BOX.y &&
					p.x + p.w <= BOX.x + 54 &&
					p.y + p.h <= BOX.y + 36
				);
			if (p.kind === "circle" || p.kind === "arc")
				return (
					p.x - p.r >= BOX.x &&
					p.x + p.r <= BOX.x + 54 &&
					p.y - p.r >= BOX.y &&
					p.y + p.r <= BOX.y + 36
				);
			return false;
		};
		for (const tool of [
			"fs.read@1",
			"web.search@1",
			"media.image.generate@1",
			"gameengine.test@1",
		])
			for (const p of screenOf(tool, BOX)) expect(inside(p), tool).toBe(true);
	});
});

describe("sleepDot", () => {
	it("drifts across a dark monitor and stays on it", () => {
		const at = (t: number) => sleepDot(BOX, 1.5, t);
		expect(at(0)).not.toEqual(at(2));
		for (let t = 0; t < 60; t += 0.7) {
			const d = at(t);
			expect(d.kind === "circle" && d.x - d.r).toBeGreaterThanOrEqual(BOX.x);
			expect(d.kind === "circle" && d.x + d.r).toBeLessThanOrEqual(BOX.x + 54);
			expect(d.kind === "circle" && d.y - d.r).toBeGreaterThanOrEqual(BOX.y);
			expect(d.kind === "circle" && d.y + d.r).toBeLessThanOrEqual(BOX.y + 36);
		}
	});
});
