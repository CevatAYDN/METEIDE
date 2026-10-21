import type { QuotaUnitSpec } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import { createPool, type PoolOptions } from "../../src/domain/pool.js";

const T0 = Date.parse("2026-10-21T12:00:00Z");
const MIN = 60_000;

const spec = (over: Partial<QuotaUnitSpec> = {}): QuotaUnitSpec => ({
	providerId: "p",
	unit: "requests_per_minute",
	limit: 2,
	scope: "account",
	reset: "sliding",
	...over,
});

const pool = (specs: QuotaUnitSpec[], opts: PoolOptions = {}) => {
	const p = createPool(opts);
	p.define(specs);
	return p;
};

const use = (p: ReturnType<typeof createPool>, model: string, at: number) =>
	p.record(p.hold("p", model, {}), {}, at);

describe("pool: capacity", () => {
	it("counts one request per call and opens when the oldest leaves", () => {
		const p = pool([spec()]);
		expect(p.has("p")).toBe(true);
		expect(p.has("q")).toBe(false);
		expect(p.check("p", "m", {}, T0)).toEqual({ kind: "open" });
		use(p, "m", T0);
		use(p, "m", T0 + 1000);
		expect(p.check("p", "m", {}, T0 + 2000)).toEqual({
			kind: "wait",
			opensAt: T0 + MIN,
		});
		expect(p.check("p", "m", {}, T0 + MIN)).toEqual({ kind: "open" });
	});

	it("counts unsettled holds, which only a settle frees", () => {
		const p = pool([spec()]);
		const a = p.hold("p", "m", {});
		p.hold("p", "m", {});
		expect(p.check("p", "m", {}, T0)).toEqual({ kind: "wait" });
		p.release(a);
		expect(p.check("p", "m", {}, T0)).toEqual({ kind: "open" });
	});

	it("waits for the latest known opening when units block differently", () => {
		const p = pool([
			spec({ limit: 1 }),
			spec({ unit: "requests_per_day", limit: 1, reset: "fixed_daily" }),
			spec({ unit: "tokens_per_minute", limit: 10 }),
		]);
		use(p, "m", T0);
		p.hold("p", "m", {
			requests_per_minute: 0,
			requests_per_day: 0,
			tokens_per_minute: 10,
		});
		expect(p.check("p", "m", { tokens_per_minute: 1 }, T0)).toEqual({
			kind: "wait",
			opensAt: Date.parse("2026-10-22T00:00:00Z"),
		});
	});

	it("never fits an amount above the limit", () => {
		const p = pool([spec({ unit: "tokens_per_minute", limit: 100 })]);
		expect(p.check("p", "m", { tokens_per_minute: 101 }, T0)).toEqual({
			kind: "never",
		});
		expect(p.check("p", "m", { tokens_per_minute: 100 }, T0)).toEqual({
			kind: "open",
		});
	});

	it("needs a unit without an amount to be below its limit", () => {
		const p = pool([spec({ unit: "tokens_per_minute", limit: 100 })]);
		p.record(p.hold("p", "m", {}), { tokens_per_minute: 100 }, T0);
		expect(p.check("p", "m", {}, T0).kind).toBe("wait");
	});

	it("counts model units per model and account units once", () => {
		const p = pool([
			spec({ limit: 1, scope: "model" }),
			spec({ unit: "requests_per_day", limit: 2, reset: "fixed_daily" }),
		]);
		use(p, "a", T0);
		expect(p.check("p", "a", {}, T0).kind).toBe("wait");
		expect(p.check("p", "b", {}, T0).kind).toBe("open");
		use(p, "b", T0);
		expect(p.check("p", "c", {}, T0)).toEqual({
			kind: "wait",
			opensAt: Date.parse("2026-10-22T00:00:00Z"),
		});
	});

	it("keeps usage when a provider is defined again", () => {
		const p = pool([spec({ limit: 1 })]);
		use(p, "m", T0);
		p.define([spec({ limit: 1 })]);
		expect(p.check("p", "m", {}, T0).kind).toBe("wait");
	});
});

describe("pool: settling", () => {
	it("records actual amounts, defaults requests to 1 and drops undefined units", () => {
		const p = pool([
			spec({ limit: 5 }),
			spec({ unit: "tokens_per_minute", limit: 1000 }),
		]);
		const consumed = p.record(
			p.hold("p", "m", {}),
			{ tokens_per_minute: 812, credits_per_month: 3 },
			T0,
		);
		expect(consumed).toEqual([
			{ providerId: "p", unit: "requests_per_minute", amount: 1 },
			{ providerId: "p", unit: "tokens_per_minute", amount: 812 },
		]);
	});

	it("releases without counting when no call was sent", () => {
		const p = pool([spec({ limit: 1 })]);
		expect(p.record(p.hold("p", "m", {}), null, T0)).toEqual([]);
		expect(p.check("p", "m", {}, T0).kind).toBe("open");
	});
});

describe("pool: limits and observations", () => {
	it("takes settings, then a header limit, then a discovered one, then the shipped value", () => {
		const settings: PoolOptions["settingsLimit"] = (id, unit) =>
			id === "p" && unit === "requests_per_day" ? 1 : undefined;
		const p = pool(
			[
				spec({ limit: 3 }),
				spec({ unit: "requests_per_day", limit: 50, reset: "fixed_daily" }),
			],
			{ settingsLimit: settings },
		);
		use(p, "m", T0);
		expect(p.check("p", "m", {}, T0).kind).toBe("wait");
		p.observe(
			"p",
			"m",
			[{ unit: "requests_per_day", limit: 1000, exhausted: false }],
			T0,
		);
		expect(p.check("p", "m", {}, T0).kind).toBe("wait");
		p.observe(
			"p",
			"m",
			[{ unit: "requests_per_minute", limit: 1, exhausted: false }],
			T0,
		);
		expect(p.limit("p", "requests_per_minute")).toBe(1);
	});

	it("discovers a limit from the first exhausted observation, without the rejected call", () => {
		const p = pool([spec({ limit: "discover" })]);
		// 7 calls went through; the 8th was refused, settled and recorded before it observes.
		for (let i = 0; i < 8; i++) use(p, "m", T0 + i);
		expect(p.check("p", "m", {}, T0 + 10).kind).toBe("open");
		p.observe(
			"p",
			"m",
			[{ unit: "requests_per_minute", exhausted: true }],
			T0 + 10,
		);
		expect(p.limit("p", "requests_per_minute")).toBe(7);
		// Usage is cut to the limit from the oldest call, so the next one to leave is at T0 + 1.
		expect(p.check("p", "m", {}, T0 + 10)).toEqual({
			kind: "wait",
			opensAt: T0 + 1 + MIN,
		});
	});

	it("discovers at least 1 when nothing was counted", () => {
		const p = pool([spec({ limit: "discover" })]);
		p.observe("p", "m", [{ unit: "requests_per_minute", exhausted: true }], T0);
		expect(p.limit("p", "requests_per_minute")).toBe(1);
	});

	it("sets usage from remaining and ignores units the provider did not define", () => {
		const p = pool([spec({ limit: 10 })]);
		p.observe(
			"p",
			"m",
			[
				{ unit: "requests_per_minute", remaining: 1, exhausted: false },
				{ unit: "credits_per_month", remaining: 0, exhausted: true },
			],
			T0,
		);
		expect(p.check("p", "m", {}, T0).kind).toBe("open");
		use(p, "m", T0);
		expect(p.check("p", "m", {}, T0).kind).toBe("wait");
	});

	it("stays closed until a response's resetsAt, then forgets the older usage", () => {
		const p = pool([spec({ limit: 10 })]);
		use(p, "m", T0);
		const resetsAt = new Date(T0 + 5000).toISOString();
		p.observe(
			"p",
			"m",
			[{ unit: "requests_per_minute", resetsAt, exhausted: true }],
			T0,
		);
		expect(p.check("p", "m", {}, T0 + 4999)).toEqual({
			kind: "wait",
			opensAt: T0 + 5000,
		});
		expect(p.check("p", "m", {}, T0 + 5000)).toEqual({ kind: "open" });
	});
});

describe("pool: sweep", () => {
	it("reports each unit closing and opening once", () => {
		const p = pool([spec({ limit: 1 })]);
		expect(p.sweep(T0)).toEqual({ closed: [], opened: [], next: undefined });
		use(p, "m", T0);
		expect(p.sweep(T0)).toEqual({
			closed: [
				{ providerId: "p", unit: "requests_per_minute", resetsAt: T0 + MIN },
			],
			opened: [],
			next: T0 + MIN,
		});
		expect(p.sweep(T0 + 1).closed).toEqual([]);
		expect(p.sweep(T0 + MIN)).toEqual({
			closed: [],
			opened: [{ providerId: "p", unit: "requests_per_minute" }],
			next: undefined,
		});
	});
});

describe("pool: persistence", () => {
	it("hands out changed units and learned limits once, and loads them back", () => {
		const p = pool([
			spec({
				unit: "requests_per_day",
				limit: "discover",
				reset: "fixed_daily",
			}),
		]);
		use(p, "m", T0);
		p.observe("p", "m", [{ unit: "requests_per_day", exhausted: true }], T0);
		const dirty = p.takeDirty();
		expect(dirty.usage).toEqual([
			{
				providerId: "p",
				unit: "requests_per_day",
				scopeKey: "",
				entries: [{ at: T0, amount: 1 }],
			},
		]);
		expect(dirty.limits).toEqual([
			{
				providerId: "p",
				unit: "requests_per_day",
				limit: 1,
				source: "discovered",
			},
		]);
		expect(p.takeDirty()).toEqual({ usage: [], limits: [] });

		const q = pool([
			spec({
				unit: "requests_per_day",
				limit: "discover",
				reset: "fixed_daily",
			}),
		]);
		q.load(dirty);
		expect(q.limit("p", "requests_per_day")).toBe(1);
		expect(q.check("p", "m", {}, T0 + 1).kind).toBe("wait");
		expect(q.takeDirty()).toEqual({ usage: [], limits: [] });
	});
});
