import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type Entry,
	nextReset,
	opensAt,
	setUsage,
	usage,
	type WindowSpec,
	windowLength,
} from "../../src/domain/windows.js";

const MIN = 60_000;
const DAY = 86_400_000;
const at = (iso: string) => Date.parse(iso);
const sliding = (unit: WindowSpec["unit"]): WindowSpec => ({
	unit,
	reset: "sliding",
});
const daily: WindowSpec = { unit: "requests_per_day", reset: "fixed_daily" };
const monthly: WindowSpec = {
	unit: "credits_per_month",
	reset: "fixed_monthly",
};

describe("windowLength", () => {
	it("follows the unit name, with a 30-day month", () => {
		expect(windowLength("requests_per_minute")).toBe(MIN);
		expect(windowLength("tokens_per_minute")).toBe(MIN);
		expect(windowLength("gpu_seconds_per_day")).toBe(DAY);
		expect(windowLength("credits_per_month")).toBe(30 * DAY);
	});
});

describe("fixed windows reset at 00:00 UTC", () => {
	const tz = process.env.TZ;
	beforeEach(() => {
		process.env.TZ = "America/New_York";
	});
	afterEach(() => {
		process.env.TZ = tz;
	});

	it("daily: the next UTC midnight, whatever the local zone", () => {
		expect(nextReset(daily, at("2026-10-21T23:59:59Z"))).toBe(
			at("2026-10-22T00:00:00Z"),
		);
		expect(nextReset(daily, at("2026-10-22T00:00:00Z"))).toBe(
			at("2026-10-23T00:00:00Z"),
		);
	});

	it("monthly: the 1st of the next month, across the year end", () => {
		expect(nextReset(monthly, at("2026-12-31T22:00:00Z"))).toBe(
			at("2027-01-01T00:00:00Z"),
		);
	});

	it("counts only entries since the period started", () => {
		const entries: Entry[] = [
			{ at: at("2026-10-20T23:59:00Z"), amount: 5 },
			{ at: at("2026-10-21T00:00:00Z"), amount: 2 },
		];
		expect(usage(daily, entries, at("2026-10-21T12:00:00Z"))).toBe(2);
		expect(usage(monthly, entries, at("2026-10-31T12:00:00Z"))).toBe(7);
		expect(usage(monthly, entries, at("2026-11-01T00:00:00Z"))).toBe(0);
	});

	it("opens at the next reset when an empty window fits", () => {
		const now = at("2026-10-21T12:00:00Z");
		const entries = [{ at: now, amount: 50 }];
		expect(opensAt(daily, entries, now, (u) => u + 1 <= 50)).toBe(
			at("2026-10-22T00:00:00Z"),
		);
		expect(opensAt(daily, entries, now, () => false)).toBeUndefined();
	});
});

describe("sliding windows", () => {
	const rpm = sliding("requests_per_minute");
	const t0 = at("2026-10-21T12:00:00Z");
	const entries: Entry[] = [
		{ at: t0, amount: 1 },
		{ at: t0 + 10_000, amount: 1 },
		{ at: t0 + 20_000, amount: 1 },
	];

	it("counts an entry until exactly one window after it", () => {
		expect(usage(rpm, entries, t0 + MIN - 1)).toBe(3);
		expect(usage(rpm, entries, t0 + MIN)).toBe(2);
	});

	it("opens when enough of the oldest amounts have left", () => {
		const now = t0 + 30_000;
		expect(opensAt(rpm, entries, now, (u) => u + 1 <= 3)).toBe(t0 + MIN);
		expect(opensAt(rpm, entries, now, (u) => u + 2 <= 3)).toBe(
			t0 + 10_000 + MIN,
		);
		expect(opensAt(rpm, entries, now, () => false)).toBeUndefined();
	});
});

describe("setUsage", () => {
	const tpm = sliding("tokens_per_minute");
	const t0 = at("2026-10-21T12:00:00Z");
	const entries: Entry[] = [
		{ at: t0 - MIN, amount: 99 },
		{ at: t0, amount: 300 },
		{ at: t0 + 1000, amount: 200 },
	];

	it("raises usage with one entry at now and drops expired entries", () => {
		expect(setUsage(tpm, entries, 800, t0 + 2000)).toEqual([
			{ at: t0, amount: 300 },
			{ at: t0 + 1000, amount: 200 },
			{ at: t0 + 2000, amount: 300 },
		]);
	});

	it("lowers usage by trimming the oldest amounts, never below zero", () => {
		expect(setUsage(tpm, entries, 350, t0 + 2000)).toEqual([
			{ at: t0, amount: 150 },
			{ at: t0 + 1000, amount: 200 },
		]);
		expect(setUsage(tpm, entries, 0, t0 + 2000)).toEqual([]);
	});
});
