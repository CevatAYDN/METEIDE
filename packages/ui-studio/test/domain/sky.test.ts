import { describe, expect, it } from "vitest";
import { mix, rgb, skyOf } from "../../src/domain/sky.js";

// The window's time of day from the user's local clock (docs/13: a window showing the local time of
// day; ADR-070), with the demo's day curve: night from 20:24 to 04:05, dusk and dawn around it.
// Dates come from the local-time constructor, so the tests do not depend on the machine's zone.

const at = (hour: number, minute = 0) => new Date(2026, 9, 24, hour, minute);

describe("skyOf", () => {
	it("is full day at noon and mid afternoon", () => {
		for (const h of [9, 12, 14, 17]) {
			const sky = skyOf(at(h));
			expect(sky.n, `${h}:00`).toBe(0);
			expect(sky.warm, `${h}:00`).toBe(0);
		}
	});

	it("is full night from late evening to before dawn", () => {
		for (const h of [21, 23, 1, 3]) expect(skyOf(at(h)).n, `${h}:00`).toBe(1);
	});

	it("darkens from 18:00 to 20:24 and brightens from 04:05 to 06:00", () => {
		const dusk = [18, 19, 20].map((h) => skyOf(at(h)).n);
		expect(dusk[0]).toBe(0);
		expect(dusk[1]).toBeGreaterThan(0);
		expect(dusk[2] ?? 0).toBeGreaterThan(dusk[1] ?? 1);
		const dawn = [4, 5, 6].map((h) => skyOf(at(h)).n);
		expect(dawn[0]).toBe(1);
		expect(dawn[1]).toBeGreaterThan(dawn[2] ?? 1);
		expect(dawn[2]).toBe(0);
	});

	it("warms the sky around sunset and sunrise only", () => {
		expect(skyOf(at(19, 12)).warm).toBeGreaterThan(0.9);
		expect(skyOf(at(5, 0)).warm).toBeGreaterThan(0.9);
		expect(skyOf(at(12)).warm).toBe(0);
		expect(skyOf(at(23)).warm).toBe(0);
	});

	it("puts the day's fraction at 0 at 06:00", () => {
		expect(skyOf(at(6)).p).toBeCloseTo(0, 6);
		expect(skyOf(at(18)).p).toBeCloseTo(0.5, 6);
		expect(skyOf(at(5, 59)).p).toBeLessThan(1);
	});
});

describe("colour helpers", () => {
	it("mixes two colours and writes them with an alpha", () => {
		expect(mix([0, 100, 200], [100, 200, 0], 0.5)).toEqual([50, 150, 100]);
		expect(rgb([1.4, 2.6, 3], 0.5)).toBe("rgba(1,3,3,0.5)");
		expect(rgb([255, 0, 0])).toBe("rgba(255,0,0,1)");
	});
});
