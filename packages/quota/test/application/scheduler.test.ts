import type { QuotaRequest, QuotaUnitSpec } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import { createScheduler } from "../../src/application/scheduler.js";
import { createPool } from "../../src/domain/pool.js";

const T0 = Date.parse("2026-10-21T12:00:00Z");
const MIN = 60_000;
const RUN_A = "00000000-0000-4000-8000-00000000000a";
const RUN_B = "00000000-0000-4000-8000-00000000000b";

const rpm = (providerId: string, limit: number): QuotaUnitSpec => ({
	providerId,
	unit: "requests_per_minute",
	limit,
	scope: "account",
	reset: "sliding",
});

// A fake clock whose timers run when time is advanced.
const setup = (specs: QuotaUnitSpec[]) => {
	let t = T0;
	let timers: { at: number; fn: () => void }[] = [];
	const pool = createPool();
	pool.define(specs);
	const scheduler = createScheduler({
		pool,
		now: () => t,
		setTimer: (fn, ms) => {
			const timer = { at: t + ms, fn };
			timers.push(timer);
			return () => {
				timers = timers.filter((x) => x !== timer);
			};
		},
	});
	const advance = (ms: number) => {
		t += ms;
		const due = timers.filter((x) => x.at <= t);
		timers = timers.filter((x) => x.at > t);
		for (const x of due) x.fn();
	};
	return { pool, scheduler, advance, pending: () => timers.length };
};

const req = (
	runId: string,
	priority: 0 | 1 | 2,
	providers: string[],
): QuotaRequest => ({
	runId,
	priority,
	chain: providers.map((providerId) => ({ providerId, modelId: "m" })),
	estimate: {},
});

const never = new AbortController().signal;
const flush = () => new Promise((r) => setTimeout(r, 0));

// Fills a provider's one-request minute so later calls have to wait.
const fill = async (s: ReturnType<typeof setup>, providerId: string) => {
	const r = await s.scheduler.reserve(req(RUN_A, 0, [providerId]), never);
	if (!r.ok) throw new Error("fill failed");
	s.pool.record(r.value.held, {}, T0);
};

describe("scheduler: the daily spending cap (ADR-042)", () => {
	it("pauses a paid chain at the cap until midnight UTC and still grants a free one", async () => {
		const cap: QuotaUnitSpec = {
			providerId: "*",
			unit: "usd_per_day",
			limit: 1,
			scope: "account",
			reset: "fixed_daily",
		};
		// The cap first, the providers' own units after, as the gateway's discovery does.
		const s = setup([cap]);
		s.pool.define([rpm("paid", 100), rpm("free", 100)]);
		const paid: QuotaRequest = {
			runId: RUN_A,
			priority: 1,
			chain: [
				{ providerId: "paid", modelId: "pro", estimate: { usd_per_day: 0.9 } },
			],
			estimate: {},
		};
		const first = await s.scheduler.reserve(paid, never);
		if (!first.ok) throw new Error("first paid call");
		s.pool.record(first.value.held, { usd_per_day: 0.9 }, T0);
		expect(await s.scheduler.reserve(paid, never)).toEqual({
			ok: false,
			error: { code: "quota_exhausted", resumesAt: "2026-10-22T00:00:00.000Z" },
		});
		const free = await s.scheduler.reserve(req(RUN_B, 1, ["free"]), never);
		expect(free.ok && free.value.providerId).toBe("free");
	});
});

describe("scheduler: reserving", () => {
	it("reserves the first chain entry with capacity", async () => {
		const s = setup([rpm("a", 1), rpm("b", 1)]);
		await fill(s, "a");
		const r = await s.scheduler.reserve(req(RUN_B, 1, ["a", "b"]), never);
		expect(r.ok && [r.value.providerId, r.value.modelId]).toEqual(["b", "m"]);
		expect(s.pending()).toBe(0);
	});

	it("rejects an undefined provider and a chain where nothing can ever fit", async () => {
		const s = setup([rpm("a", 1)]);
		await expect(
			s.scheduler.reserve(req(RUN_A, 1, ["a", "x"]), never),
		).rejects.toThrow(/not defined/);
		const big = {
			...req(RUN_A, 1, ["a"]),
			estimate: { requests_per_minute: 2 },
		};
		await expect(s.scheduler.reserve(big, never)).rejects.toThrow(/never fit/);
	});

	it("returns aborted at once for an aborted signal", async () => {
		const s = setup([rpm("a", 1)]);
		const c = new AbortController();
		c.abort();
		expect(await s.scheduler.reserve(req(RUN_A, 1, ["a"]), c.signal)).toEqual({
			ok: false,
			error: { code: "aborted" },
		});
	});
});

describe("scheduler: waiting", () => {
	it("pauses at once when the earliest reset is more than 90 seconds away", async () => {
		const s = setup([
			{ ...rpm("a", 1), unit: "requests_per_day", reset: "fixed_daily" },
		]);
		await fill(s, "a");
		expect(await s.scheduler.reserve(req(RUN_B, 1, ["a"]), never)).toEqual({
			ok: false,
			error: { code: "quota_exhausted", resumesAt: "2026-10-22T00:00:00.000Z" },
		});
	});

	it("waits for a reset within 90 seconds and is served by the timer", async () => {
		const s = setup([rpm("a", 1)]);
		await fill(s, "a");
		s.advance(30_000);
		const p = s.scheduler.reserve(req(RUN_B, 1, ["a"]), never);
		s.advance(MIN - 30_000);
		const r = await p;
		expect(r.ok && r.value.providerId).toBe("a");
		expect(s.pending()).toBe(0);
	});

	it("waits on unsettled holds and gives up after 90 seconds with resumesAt now", async () => {
		const s = setup([rpm("a", 1)]);
		await s.scheduler.reserve(req(RUN_A, 0, ["a"]), never);
		const p = s.scheduler.reserve(req(RUN_B, 1, ["a"]), never);
		s.advance(90_000);
		expect(await p).toEqual({
			ok: false,
			error: {
				code: "quota_exhausted",
				resumesAt: new Date(T0 + 90_000).toISOString(),
			},
		});
		expect(s.pending()).toBe(0);
	});

	it("serves a waiter when a settle frees capacity", async () => {
		const s = setup([rpm("a", 1)]);
		const first = await s.scheduler.reserve(req(RUN_A, 0, ["a"]), never);
		const p = s.scheduler.reserve(req(RUN_B, 1, ["a"]), never);
		if (first.ok) s.pool.record(first.value.held, null, T0);
		s.scheduler.wake();
		expect((await p).ok).toBe(true);
	});

	it("returns aborted when the signal aborts mid-wait and frees the turn", async () => {
		const s = setup([rpm("a", 1)]);
		await fill(s, "a");
		const c = new AbortController();
		const first = s.scheduler.reserve(req(RUN_A, 0, ["a"]), c.signal);
		const second = s.scheduler.reserve(req(RUN_B, 0, ["a"]), never);
		c.abort();
		expect(await first).toEqual({ ok: false, error: { code: "aborted" } });
		s.advance(MIN);
		expect((await second).ok).toBe(true);
		expect(s.pending()).toBe(0);
	});
});

describe("scheduler: order", () => {
	it("serves P0 before P1 when capacity for one opens", async () => {
		const s = setup([rpm("a", 1)]);
		await fill(s, "a");
		s.advance(30_000);
		const order: string[] = [];
		const p1 = s.scheduler.reserve(req(RUN_A, 1, ["a"]), never).then((r) => {
			order.push("p1");
			return r;
		});
		const p0 = s.scheduler.reserve(req(RUN_B, 0, ["a"]), never).then((r) => {
			order.push("p0");
			return r;
		});
		s.advance(30_000);
		const r0 = await p0;
		await flush();
		expect(order).toEqual(["p0"]);
		if (r0.ok) s.pool.record(r0.value.held, null, T0 + MIN);
		s.scheduler.wake();
		expect((await p1).ok).toBe(true);
		expect(order).toEqual(["p0", "p1"]);
	});

	it("serves runs of one class in turn", async () => {
		const s = setup([rpm("a", 2)]);
		await fill(s, "a");
		await fill(s, "a");
		s.advance(1000);
		const served: string[] = [];
		const ask = (runId: string, name: string) =>
			s.scheduler
				.reserve(req(runId, 1, ["a"]), never)
				.then((r) => r.ok && served.push(name));
		const all = [
			ask(RUN_A, "a1"),
			ask(RUN_A, "a2"),
			ask(RUN_A, "a3"),
			ask(RUN_B, "b1"),
		];
		s.advance(MIN);
		await flush();
		expect(served.sort()).toEqual(["a1", "b1"]);
		s.scheduler.dispose();
		await Promise.all(all);
	});

	it("keeps a claimed provider for the earlier waiter but lets later calls use others", async () => {
		const s = setup([rpm("a", 1), rpm("b", 1)]);
		await fill(s, "a");
		s.advance(30_000);
		const waiting = s.scheduler.reserve(req(RUN_A, 1, ["a"]), never);
		const viaB = await s.scheduler.reserve(req(RUN_B, 2, ["a", "b"]), never);
		expect(viaB.ok && viaB.value.providerId).toBe("b");
		const onlyA = s.scheduler.reserve(req(RUN_B, 2, ["a"]), never);
		s.advance(30_000);
		expect((await waiting).ok).toBe(true);
		s.scheduler.dispose();
		expect(await onlyA).toEqual({ ok: false, error: { code: "aborted" } });
		expect(s.pending()).toBe(0);
	});

	it("does not let a smaller later call take capacity an earlier waiter needs", async () => {
		const tpm: QuotaUnitSpec = {
			...rpm("a", 100),
			unit: "tokens_per_minute",
		};
		const s = setup([tpm]);
		const first = await s.scheduler.reserve(req(RUN_A, 0, ["a"]), never);
		if (first.ok)
			s.pool.record(first.value.held, { tokens_per_minute: 50 }, T0);
		const big = s.scheduler.reserve(
			{ ...req(RUN_A, 1, ["a"]), estimate: { tokens_per_minute: 100 } },
			never,
		);
		const small = s.scheduler.reserve(
			{ ...req(RUN_B, 2, ["a"]), estimate: { tokens_per_minute: 10 } },
			never,
		);
		const early: string[] = [];
		void small.then(() => early.push("small"));
		await flush();
		expect(early).toEqual([]);
		s.advance(MIN);
		expect((await big).ok).toBe(true);
		s.scheduler.dispose();
		expect(await small).toEqual({ ok: false, error: { code: "aborted" } });
	});
});
