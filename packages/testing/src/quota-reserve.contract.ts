import type {
	QuotaRequest,
	QuotaReserveAdapter,
	QuotaUnitSpec,
} from "@mete/contracts";
import { afterEach, describe, expect, it } from "vitest";

// Contract kit for quota.reserve@2 (docs/09, Quota pool).

/** The fixed time every kit adapter's clock MUST return. */
export const QUOTA_KIT_NOW = Date.parse("2026-10-21T12:00:00Z");

/** Opens a fresh, empty pool whose clock returns `now`; `close` releases it. */
export type QuotaReserveHarness = (now: () => number) => Promise<{
	readonly adapter: QuotaReserveAdapter;
	readonly close: () => Promise<void>;
}>;

const RUN = "00000000-0000-4000-8000-0000000000c1";

const daily = (providerId: string): QuotaUnitSpec => ({
	providerId,
	unit: "requests_per_day",
	limit: 1,
	scope: "account",
	reset: "fixed_daily",
});

const ask = (...providers: string[]): QuotaRequest => ({
	runId: RUN,
	priority: 1,
	chain: providers.map((providerId) => ({ providerId, modelId: "m" })),
	estimate: {},
});

const signal = () => new AbortController().signal;

/** Every quota.reserve@2 adapter MUST pass these tests. */
export const quotaReserveContract = (name: string, open: QuotaReserveHarness) =>
	describe(`quota.reserve@2 contract: ${name}`, () => {
		let close: (() => Promise<void>) | undefined;
		afterEach(async () => {
			await close?.();
			close = undefined;
		});
		const fresh = async () => {
			const h = await open(() => QUOTA_KIT_NOW);
			close = h.close;
			return h.adapter;
		};

		it("reserves the first entry with capacity and settles each reservation once", async () => {
			const a = await fresh();
			a.define([daily("a"), daily("b")]);
			const first = await a.reserve(ask("a", "b"), signal());
			expect(first.ok && first.value.providerId).toBe("a");
			if (!first.ok) return;
			expect(a.settle(first.value.id, {}, [])).toEqual({
				ok: true,
				value: undefined,
			});
			expect(a.settle(first.value.id, {}, [])).toEqual({
				ok: false,
				error: { code: "unknown_reservation", id: first.value.id },
			});
			const second = await a.reserve(ask("a", "b"), signal());
			expect(second.ok && second.value.providerId).toBe("b");
		});

		it("returns quota_exhausted with the earliest reset when it is far away", async () => {
			const a = await fresh();
			a.define([daily("a")]);
			const r = await a.reserve(ask("a"), signal());
			if (r.ok) a.settle(r.value.id, {}, []);
			expect(await a.reserve(ask("a"), signal())).toEqual({
				ok: false,
				error: {
					code: "quota_exhausted",
					resumesAt: "2026-10-22T00:00:00.000Z",
				},
			});
		});

		it("releases a reservation settled with null", async () => {
			const a = await fresh();
			a.define([daily("a")]);
			const r = await a.reserve(ask("a"), signal());
			if (r.ok) a.settle(r.value.id, null, []);
			expect((await a.reserve(ask("a"), signal())).ok).toBe(true);
		});

		it("returns aborted for an aborted signal and throws for an undefined provider", async () => {
			const a = await fresh();
			a.define([daily("a")]);
			const c = new AbortController();
			c.abort();
			expect(await a.reserve(ask("a"), c.signal)).toEqual({
				ok: false,
				error: { code: "aborted" },
			});
			await expect(a.reserve(ask("x"), signal())).rejects.toThrow();
		});
	});
