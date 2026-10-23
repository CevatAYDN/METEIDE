import type { QuotaUnitSpec } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import { createPool } from "../../src/domain/pool.js";

// The pool read of quota.reserve@4 (docs/09, usage(); ADR-054).

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

const pool = (specs: QuotaUnitSpec[]) => {
	const p = createPool();
	p.define(specs);
	return p;
};

const use = (p: ReturnType<typeof createPool>, model: string, at: number) =>
	p.record(p.hold("p", model, {}), {}, at);

describe("pool usage", () => {
	it("lists an unused unit once, with its limit and the reset of a fixed window", () => {
		const p = pool([
			spec(),
			spec({ unit: "requests_per_day", limit: 50, reset: "fixed_daily" }),
		]);
		expect(p.usage(T0)).toEqual([
			{
				providerId: "p",
				unit: "requests_per_minute",
				scope: null,
				used: 0,
				limit: 2,
				history: [],
			},
			{
				providerId: "p",
				unit: "requests_per_day",
				scope: null,
				used: 0,
				limit: 50,
				resetsAt: Date.parse("2026-10-22T00:00:00Z"),
				history: [],
			},
		]);
	});

	it("counts the window only, oldest first, and leaves the state as it was", () => {
		const p = pool([spec({ limit: 10 })]);
		use(p, "m", T0);
		use(p, "m", T0 + MIN);
		const [row] = p.usage(T0 + MIN + 1000);
		expect(row?.used).toBe(1);
		expect(row?.history).toEqual([{ at: T0 + MIN, amount: 1 }]);
		expect(p.usage(T0 + MIN + 1000)).toEqual([row]);
	});

	it("gives a model unit one row per model it counted", () => {
		const p = pool([spec({ scope: "model", limit: 5 })]);
		use(p, "a", T0);
		use(p, "b", T0);
		use(p, "b", T0 + 1);
		expect(p.usage(T0 + 2).map((r) => [r.scope, r.used])).toEqual([
			["a", 1],
			["b", 2],
		]);
	});

	it("has no limit before a discover unit learns one, and keeps a response reset until it passes", () => {
		const p = pool([spec({ limit: "discover" })]);
		use(p, "m", T0);
		expect(p.usage(T0)[0]?.limit).toBeNull();
		const resetsAt = T0 + 30_000;
		p.observe(
			"p",
			"m",
			[
				{
					unit: "requests_per_minute",
					exhausted: true,
					resetsAt: new Date(resetsAt).toISOString(),
				},
			],
			T0 + 1,
		);
		const closed = p.usage(T0 + 2)[0];
		expect(closed?.limit).toBe(1);
		expect(closed?.resetsAt).toBe(resetsAt);
		const after = p.usage(resetsAt + 1)[0];
		expect(after?.used).toBe(0);
		expect(after?.resetsAt).toBeUndefined();
	});
});
