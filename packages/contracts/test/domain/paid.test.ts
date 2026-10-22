import { describe, expect, it } from "vitest";
import { ModelInfoSchema } from "../../src/domain/provider.js";
import { QuotaUnitSchema } from "../../src/domain/states.js";

const model = {
	id: "m",
	providerId: "p",
	family: "f",
	contextWindow: 128_000,
	toolCalling: true,
	vision: false,
	free: false,
	deprecated: false,
};

describe("provider.chat@2 and quota.reserve@2 (ADR-042)", () => {
	it("takes a price in US dollars per million tokens, and none for a free model", () => {
		expect(ModelInfoSchema.safeParse(model).success).toBe(true);
		const priced = { ...model, price: { input: 0.15, output: 0.6 } };
		expect(ModelInfoSchema.parse(priced).price).toEqual({
			input: 0.15,
			output: 0.6,
		});
		const negative = { ...model, price: { input: -1, output: 0 } };
		expect(ModelInfoSchema.safeParse(negative).success).toBe(false);
	});

	it("knows the daily spending unit", () => {
		expect(QuotaUnitSchema.parse("usd_per_day")).toBe("usd_per_day");
	});
});
