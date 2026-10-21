import type { QuotaRequest, QuotaUnitSpec } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import { folders, setup, T0, WORKSPACE } from "./setup.js";

const RUN = "00000000-0000-4000-8000-000000000001";
const never = new AbortController().signal;

const spec = (over: Partial<QuotaUnitSpec> = {}): QuotaUnitSpec => ({
	providerId: "p",
	unit: "requests_per_minute",
	limit: 1,
	scope: "account",
	reset: "sliding",
	...over,
});

const req: QuotaRequest = {
	runId: RUN,
	priority: 1,
	chain: [{ providerId: "p", modelId: "m" }],
	estimate: {},
};

const active = async (quota: unknown = {}) => {
	const s = await setup(await folders(), quota);
	expect(await s.quotaModule.activate(s.ctx)).toEqual({
		ok: true,
		value: undefined,
	});
	return s;
};

describe("quota module: activation", () => {
	it("fails without storage or with an invalid quota file", async () => {
		const s = await setup(await folders(), { limits: [{ providerId: "p" }] });
		expect((await s.quotaModule.activate(s.base)).ok).toBe(false);
		const r = await s.quotaModule.activate(s.ctx);
		expect(!r.ok && r.error.message).toMatch(/quota\.yaml limits/);
		await s.close();
	});
});

describe("quota module: reserve and settle", () => {
	it("publishes quota.consumed with the run id and closes the unit", async () => {
		const s = await active();
		const a = s.adapter();
		a.define([spec()]);
		const r = await a.reserve(req, never);
		if (!r.ok) throw new Error("reserve failed");
		expect(r.value).toMatchObject({ providerId: "p", modelId: "m" });
		expect(a.settle(r.value.id, {}, [])).toEqual({
			ok: true,
			value: undefined,
		});
		expect(
			s.events.map((e) => [e.type, e.runId, e.workspaceId, e.payload]),
		).toEqual([
			[
				"quota.consumed",
				RUN,
				WORKSPACE,
				{ providerId: "p", unit: "requests_per_minute", amount: 1 },
			],
			[
				"quota.exhausted",
				undefined,
				WORKSPACE,
				{
					providerId: "p",
					unit: "requests_per_minute",
					resetsAt: new Date(T0 + 60_000).toISOString(),
				},
			],
		]);
		s.time.advance(60_000);
		expect(s.events.at(-1)?.type).toBe("quota.restored");
		expect(s.time.pending()).toBe(0);
		await s.close();
	});

	it("refuses an unknown or already settled id", async () => {
		const s = await active();
		const a = s.adapter();
		a.define([spec()]);
		const r = await a.reserve(req, never);
		if (!r.ok) throw new Error("reserve failed");
		a.settle(r.value.id, null, []);
		expect(a.settle(r.value.id, null, [])).toEqual({
			ok: false,
			error: { code: "unknown_reservation", id: r.value.id },
		});
		await s.close();
	});

	it("throws on a bad observation and keeps the reservation", async () => {
		const s = await active();
		const a = s.adapter();
		a.define([spec()]);
		const r = await a.reserve(req, never);
		if (!r.ok) throw new Error("reserve failed");
		const bad = [{ unit: "requests_per_minute", exhausted: "yes" }];
		// @ts-expect-error a provider adapter that breaks the contract
		expect(() => a.settle(r.value.id, {}, bad)).toThrow();
		expect(a.settle(r.value.id, {}, []).ok).toBe(true);
		await s.close();
	});

	it("throws on an invalid request or spec", async () => {
		const s = await active();
		const a = s.adapter();
		expect(() => a.define([{ ...spec(), limit: 0 }])).toThrow();
		a.define([spec()]);
		await expect(
			a.reserve({ ...req, runId: "run-1" }, never),
		).rejects.toThrow();
		await s.close();
	});

	it("uses the configured limit over the shipped one", async () => {
		const s = await active({
			limits: [{ providerId: "p", unit: "requests_per_minute", limit: 2 }],
		});
		const a = s.adapter();
		a.define([spec()]);
		for (let i = 0; i < 2; i++) {
			const r = await a.reserve(req, never);
			if (!r.ok) throw new Error("reserve failed");
			a.settle(r.value.id, {}, []);
		}
		expect(s.events.filter((e) => e.type === "quota.consumed")).toHaveLength(2);
		await s.close();
	});
});

describe("quota module: restart", () => {
	it("keeps day usage across a restart and aborts waiters on deactivate", async () => {
		const dirs = await folders();
		const day = spec({ unit: "requests_per_day", reset: "fixed_daily" });
		const first = await setup(dirs);
		await first.quotaModule.activate(first.ctx);
		first.adapter().define([day]);
		const r = await first.adapter().reserve(req, never);
		if (!r.ok) throw new Error("reserve failed");
		first.adapter().settle(r.value.id, {}, []);
		await first.close();

		const second = await setup(dirs);
		await second.quotaModule.activate(second.ctx);
		second.adapter().define([day]);
		expect(second.events.map((e) => [e.type, e.payload])).toEqual([
			[
				"quota.exhausted",
				{
					providerId: "p",
					unit: "requests_per_day",
					resetsAt: "2026-10-22T00:00:00.000Z",
				},
			],
		]);
		expect(second.time.pending()).toBe(1);
		expect(await second.adapter().reserve(req, never)).toEqual({
			ok: false,
			error: { code: "quota_exhausted", resumesAt: "2026-10-22T00:00:00.000Z" },
		});
		second.adapter().define([spec()]);
		const held = await second.adapter().reserve(req, never);
		const waiting = second.adapter().reserve(req, never);
		await second.close();
		expect(held.ok).toBe(true);
		expect(await waiting).toEqual({ ok: false, error: { code: "aborted" } });
	});
});
