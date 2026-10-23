import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
	createQuotaStore,
	QUOTA_MIGRATIONS,
} from "../../src/infrastructure/quota-store.js";

const T0 = Date.parse("2026-10-21T12:00:30Z");
const MIN = 60_000;
const DAY = 86_400_000;

const open = (now = T0) => {
	const db = new Database(":memory:");
	for (const m of QUOTA_MIGRATIONS) db.exec(m.sql);
	return { db, store: createQuotaStore(db, () => now) };
};

describe("quota store", () => {
	it("saves day and month usage in minute buckets and skips minute units", () => {
		const { store } = open();
		store.save({
			usage: [
				{
					providerId: "p",
					unit: "requests_per_day",
					scopeKey: "",
					entries: [
						{ at: T0, amount: 1 },
						{ at: T0 + 20_000, amount: 2 },
						{ at: T0 + MIN, amount: 1 },
					],
				},
				{
					providerId: "p",
					unit: "requests_per_minute",
					scopeKey: "",
					entries: [{ at: T0, amount: 1 }],
				},
			],
			limits: [],
		});
		const bucket = Math.floor(T0 / MIN) * MIN;
		expect(store.load().usage).toEqual([
			{
				providerId: "p",
				unit: "requests_per_day",
				scopeKey: "",
				entries: [
					{ at: bucket + MIN - 1, amount: 3 },
					{ at: bucket + 2 * MIN - 1, amount: 1 },
				],
			},
		]);
	});

	it("replaces a unit's saved usage when it is saved again", () => {
		const { store } = open();
		const row = (amount: number) => ({
			providerId: "p",
			unit: "credits_per_month" as const,
			scopeKey: "m",
			entries: [{ at: T0, amount }],
		});
		store.save({ usage: [row(5)], limits: [] });
		store.save({ usage: [row(2)], limits: [] });
		expect(store.load().usage[0]?.entries).toEqual([
			{ at: Math.floor(T0 / MIN) * MIN + MIN - 1, amount: 2 },
		]);
	});

	// ADR-074: two processes on one database add their usage; each save writes only its growth.
	describe("two processes on one database", () => {
		const row = (amount: number) => ({
			providerId: "p",
			unit: "requests_per_day" as const,
			scopeKey: "",
			entries: amount > 0 ? [{ at: T0, amount }] : [],
		});
		const saved = (db: ReturnType<typeof open>["db"]) =>
			db.prepare("SELECT used FROM quota_usage ORDER BY window_start").all();

		it("keeps both processes' calls in the same bucket, and adds only each one's growth later", () => {
			const { db, store: a } = open();
			const b = createQuotaStore(db, () => T0);
			a.load();
			b.load();
			a.save({ usage: [row(5)], limits: [] });
			b.save({ usage: [row(3)], limits: [] });
			expect(saved(db)).toEqual([{ used: 8 }]);
			a.save({ usage: [row(7)], limits: [] });
			expect(saved(db)).toEqual([{ used: 10 }]);
			a.save({ usage: [row(7)], limits: [] });
			expect(saved(db)).toEqual([{ used: 10 }]);
		});

		it("starts a new process from the sum", () => {
			const { db, store: a } = open();
			a.load();
			a.save({ usage: [row(5)], limits: [] });
			const b = createQuotaStore(db, () => T0);
			expect(b.load().usage[0]?.entries).toEqual([
				{ at: Math.floor(T0 / MIN) * MIN + MIN - 1, amount: 5 },
			]);
			b.save({ usage: [row(6)], limits: [] });
			expect(saved(db)).toEqual([{ used: 6 }]);
		});

		it("deletes a bucket a process dropped for everyone, and does not write one another process deleted back", () => {
			const { db, store: a } = open();
			const b = createQuotaStore(db, () => T0);
			a.load();
			b.load();
			a.save({ usage: [row(5)], limits: [] });
			b.load();
			a.save({ usage: [row(0)], limits: [] });
			expect(saved(db)).toEqual([]);
			b.save({ usage: [row(5)], limits: [] });
			expect(saved(db)).toEqual([]);
		});
	});

	it("upserts learned limits", () => {
		const { store } = open();
		const limit = {
			providerId: "p",
			unit: "requests_per_minute" as const,
			limit: 7,
			source: "discovered" as const,
		};
		store.save({ usage: [], limits: [limit] });
		store.save({
			usage: [],
			limits: [{ ...limit, limit: 40, source: "header" }],
		});
		expect(store.load().limits).toEqual([
			{ ...limit, limit: 40, source: "header" },
		]);
	});

	it("drops buckets older than the longest window when loading", () => {
		const { db, store } = open(T0 + 32 * DAY);
		createQuotaStore(db, () => T0).save({
			usage: [
				{
					providerId: "p",
					unit: "requests_per_day",
					scopeKey: "",
					entries: [{ at: T0, amount: 1 }],
				},
			],
			limits: [],
		});
		expect(store.load().usage).toEqual([]);
		expect(db.prepare("SELECT COUNT(*) AS n FROM quota_usage").get()).toEqual({
			n: 0,
		});
	});
});
