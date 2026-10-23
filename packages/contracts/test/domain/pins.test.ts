import { describe, expect, it } from "vitest";
import { PinsSchema, pinOf } from "../../src/domain/pins.js";

// A member's pinned model (ADR-077): template id, role id, "<providerId>/<modelId>".

describe("PinsSchema", () => {
	it("reads pins by template and role, and none when the file is empty", () => {
		const pins = {
			"web-dev": { frontend_developer: "groq/openai/gpt-oss-120b" },
		};
		expect(PinsSchema.parse(pins)).toEqual(pins);
		expect(PinsSchema.parse(undefined)).toEqual({});
	});

	it("refuses a pin without a provider and a model, and ids of the wrong shape", () => {
		for (const bad of [
			{ "web-dev": { qa: "groq" } },
			{ "web-dev": { qa: "/m" } },
			{ "web-dev": { qa: "groq/" } },
			{ Web_Dev: { qa: "groq/m" } },
			{ "web-dev": { QA: "groq/m" } },
		])
			expect(PinsSchema.safeParse(bad).success).toBe(false);
	});
});

describe("pinOf", () => {
	it("splits a role's pin at the first slash, so a model id may hold one", () => {
		const pins = { "web-dev": { qa: "openrouter/meta-llama/llama-4:free" } };
		expect(pinOf(pins, "web-dev", "qa")).toEqual({
			providerId: "openrouter",
			modelId: "meta-llama/llama-4:free",
		});
		expect(pinOf(pins, "web-dev", "lead")).toBeUndefined();
		expect(pinOf(pins, "research", "qa")).toBeUndefined();
	});
});
