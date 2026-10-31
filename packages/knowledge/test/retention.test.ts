import { describe, expect, it } from "vitest";
import { type Aging, isCold, retention } from "../src/domain/retention.js";

// docs/11, Aging and restore (ADR-173): the retention score and when a note goes cold.
const NOW = Date.parse("2026-10-31T12:00:00Z");
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();
const note = (over: Partial<Aging> = {}): Aging => ({
	type: "lesson",
	pinned: false,
	accesses: 0,
	...over,
});

describe("retention", () => {
	it("is the salience for a note written now that was never found", () => {
		expect(retention(0.8, note({ born: ago(0) }), NOW)).toBeCloseTo(0.8, 6);
	});

	it("adds the accesses, fading with the days since the last one", () => {
		const fresh = note({ born: ago(0), accesses: 3, lastAccess: ago(0) });
		expect(retention(0.8, fresh, NOW)).toBeCloseTo(0.8 + 0.6 * Math.log(4), 6);
		const stale = note({ born: ago(0), accesses: 3, lastAccess: ago(25) });
		expect(retention(0.8, stale, NOW)).toBeCloseTo(
			0.8 + 0.6 * Math.log(4) * Math.exp(-1),
			6,
		);
	});
});

describe("isCold", () => {
	it("cools a lesson after about 69 days and a journal note after about 46", () => {
		expect(isCold(note({ born: ago(68) }), NOW)).toBe(false);
		expect(isCold(note({ born: ago(70) }), NOW)).toBe(true);
		expect(isCold(note({ type: "journal", born: ago(45) }), NOW)).toBe(false);
		expect(isCold(note({ type: "journal", born: ago(47) }), NOW)).toBe(true);
	});

	it("keeps an old lesson warm while it is still found, and cools it once it is not", () => {
		const found = note({ born: ago(200), accesses: 3, lastAccess: ago(1) });
		expect(isCold(found, NOW)).toBe(false);
		const forgotten = { ...found, lastAccess: ago(100) };
		expect(isCold(forgotten, NOW)).toBe(true);
	});

	it("never cools a pinned note, a decision, an entity or an inbox note", () => {
		const old = ago(1000);
		expect(isCold(note({ born: old, pinned: true }), NOW)).toBe(false);
		for (const type of ["decision", "entity", "inbox"] as const)
			expect(isCold(note({ type, born: old }), NOW)).toBe(false);
	});

	it("counts a missing, unreadable or future date as written now", () => {
		expect(isCold(note(), NOW)).toBe(false);
		expect(isCold(note({ born: "last spring" }), NOW)).toBe(false);
		expect(isCold(note({ born: ago(-30) }), NOW)).toBe(false);
	});
});
