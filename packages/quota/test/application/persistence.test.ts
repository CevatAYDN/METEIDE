import type { QuotaRequest, QuotaUnitSpec } from "@mete/contracts";
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { createQuotaReserve } from "../../src/application/quota-reserve.js";
import { createScheduler } from "../../src/application/scheduler.js";
import { createPool } from "../../src/domain/pool.js";
import {
	createQuotaStore,
	QUOTA_MIGRATIONS,
} from "../../src/infrastructure/quota-store.js";

describe("quota persistence after a transient storage failure", () => {
	it.each(["change", "dispose"])(
		"retries unchanged usage and learned limits on %s",
		async (retry) => {
			const db = new Database(":memory:");
			for (const migration of QUOTA_MIGRATIONS) db.exec(migration.sql);
			const now = () => Date.parse("2026-11-07T10:00:00Z");
			const setTimer = () => () => {};
			const pool = createPool();
			const store = createQuotaStore(db, now);
			const scheduler = createScheduler({ pool, now, setTimer });
			let fail = true;
			const error = vi.fn();
			const created = createQuotaReserve({
				pool,
				scheduler,
				now,
				setTimer,
				store: {
					load: store.load,
					save: (dirty) => {
						if (fail && dirty.usage.length > 0) {
							fail = false;
							throw new Error("temporary database lock");
						}
						store.save(dirty);
					},
				},
				emit: () => {},
				logger: { error, warn: () => {}, info: () => {}, debug: () => {} },
			});
			try {
				const spec: QuotaUnitSpec = {
					providerId: "p",
					unit: "requests_per_day",
					limit: 10,
					scope: "account",
					reset: "fixed_daily",
				};
				created.adapter.define([spec]);
				const request: QuotaRequest = {
					runId: "00000000-0000-4000-8000-000000000001",
					priority: 1,
					chain: [{ providerId: "p", modelId: "m" }],
					estimate: {},
				};
				const held = await created.adapter.reserve(
					request,
					new AbortController().signal,
				);
				if (!held.ok) throw new Error("reservation failed");
				created.adapter.settle(held.value.id, {}, [
					{
						unit: "requests_per_day",
						limit: 8,
						exhausted: false,
					},
				]);
				expect(error).toHaveBeenCalledOnce();
				expect(store.load()).toEqual({ usage: [], limits: [] });
				if (retry === "change")
					created.adapter.define([{ ...spec, providerId: "other" }]);
				else created.dispose();
				const saved = createQuotaStore(db, now).load();
				expect(saved.usage).toEqual([
					expect.objectContaining({
						providerId: "p",
						unit: "requests_per_day",
						entries: [{ at: now() + 59_999, amount: 1 }],
					}),
				]);
				expect(saved.limits).toEqual([
					{
						providerId: "p",
						unit: "requests_per_day",
						limit: 8,
						source: "header",
					},
				]);
			} finally {
				created.dispose();
				db.close();
			}
		},
	);
});
