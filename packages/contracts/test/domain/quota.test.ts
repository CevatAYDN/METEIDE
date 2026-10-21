import { describe, expect, it } from "vitest";
import {
	QuotaAmountsSchema,
	QuotaConfigSchema,
	QuotaObservationSchema,
	QuotaRequestSchema,
	QuotaUnitSpecSchema,
} from "../../src/domain/quota.js";

const RUN = "7f3c2a1e-4b5d-4c6e-8f9a-0b1c2d3e4f5a";

describe("QuotaUnitSpecSchema", () => {
	const spec = {
		providerId: "openrouter",
		unit: "requests_per_day",
		limit: 50,
		scope: "account",
		reset: "fixed_daily",
	};

	it("accepts a numeric or discovered limit", () => {
		expect(QuotaUnitSpecSchema.parse(spec)).toEqual(spec);
		expect(
			QuotaUnitSpecSchema.safeParse({ ...spec, limit: "discover" }).success,
		).toBe(true);
	});

	it("rejects a limit of zero, unknown units and extra keys", () => {
		expect(QuotaUnitSpecSchema.safeParse({ ...spec, limit: 0 }).success).toBe(
			false,
		);
		expect(
			QuotaUnitSpecSchema.safeParse({ ...spec, unit: "requests_per_hour" })
				.success,
		).toBe(false);
		expect(QuotaUnitSpecSchema.safeParse({ ...spec, extra: 1 }).success).toBe(
			false,
		);
	});
});

describe("QuotaAmountsSchema", () => {
	it("takes any subset of units with amounts of zero or more", () => {
		expect(QuotaAmountsSchema.parse({})).toEqual({});
		expect(QuotaAmountsSchema.parse({ tokens_per_minute: 812 })).toEqual({
			tokens_per_minute: 812,
		});
		expect(
			QuotaAmountsSchema.safeParse({ tokens_per_minute: -1 }).success,
		).toBe(false);
		expect(QuotaAmountsSchema.safeParse({ tokens: 1 }).success).toBe(false);
	});
});

describe("QuotaObservationSchema", () => {
	it("needs exhausted and an ISO reset time when one is given", () => {
		expect(
			QuotaObservationSchema.safeParse({
				unit: "requests_per_minute",
				remaining: 0,
				resetsAt: "2026-10-21T12:00:00Z",
				exhausted: true,
			}).success,
		).toBe(true);
		expect(
			QuotaObservationSchema.safeParse({ unit: "requests_per_minute" }).success,
		).toBe(false);
		expect(
			QuotaObservationSchema.safeParse({
				unit: "requests_per_minute",
				resetsAt: "in 30 seconds",
				exhausted: false,
			}).success,
		).toBe(false);
	});
});

describe("QuotaConfigSchema", () => {
	it("defaults to no limits and rejects a provider unit set twice", () => {
		expect(QuotaConfigSchema.parse(undefined)).toEqual({ limits: [] });
		const limit = {
			providerId: "nvidia",
			unit: "requests_per_minute",
			limit: 30,
		};
		expect(QuotaConfigSchema.parse({ limits: [limit] }).limits).toEqual([
			limit,
		]);
		const twice = QuotaConfigSchema.safeParse({ limits: [limit, limit] });
		expect(
			twice.success ? [] : twice.error.issues.map((i) => i.path.join(".")),
		).toEqual(["limits.1"]);
		expect(
			QuotaConfigSchema.safeParse({ limits: [{ ...limit, limit: 0 }] }).success,
		).toBe(false);
	});
});

describe("QuotaRequestSchema", () => {
	const req = {
		runId: RUN,
		priority: 1,
		chain: [{ providerId: "nvidia", modelId: "m1" }],
		estimate: { tokens_per_minute: 4096 },
	};

	it("accepts a run, a class from 0 to 2 and a chain", () => {
		expect(QuotaRequestSchema.parse(req)).toEqual(req);
	});

	it("rejects an empty chain and an unknown class", () => {
		expect(QuotaRequestSchema.safeParse({ ...req, chain: [] }).success).toBe(
			false,
		);
		expect(QuotaRequestSchema.safeParse({ ...req, priority: 3 }).success).toBe(
			false,
		);
	});
});
