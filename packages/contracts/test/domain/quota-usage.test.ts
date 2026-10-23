import { describe, expect, it } from "vitest";
import { QuotaUsageSchema } from "../../src/domain/quota.js";

// What quota.reserve@4 usage() answers per unit and scope (ADR-054).

const row = {
	providerId: "openrouter",
	unit: "requests_per_day",
	scope: null,
	used: 3,
	limit: 50,
	resetsAt: "2026-10-22T00:00:00.000Z",
	history: [{ at: "2026-10-21T12:00:00.000Z", amount: 3 }],
};

describe("quota.reserve@4 usage rows (ADR-054)", () => {
	it("takes a model scope, an unknown limit and no reset", () => {
		expect(QuotaUsageSchema.safeParse(row).success).toBe(true);
		const { resetsAt: _, ...noReset } = row;
		const open = { ...noReset, scope: "m", limit: null };
		expect(QuotaUsageSchema.safeParse(open).success).toBe(true);
	});

	it("refuses negative usage, a zero limit and an unknown unit", () => {
		expect(QuotaUsageSchema.safeParse({ ...row, used: -1 }).success).toBe(
			false,
		);
		expect(QuotaUsageSchema.safeParse({ ...row, limit: 0 }).success).toBe(
			false,
		);
		expect(QuotaUsageSchema.safeParse({ ...row, unit: "hours" }).success).toBe(
			false,
		);
	});
});
