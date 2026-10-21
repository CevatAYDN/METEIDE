import { describe, expect, it } from "vitest";
import {
	LlmChatRequestSchema,
	PrivacyConfigSchema,
} from "../../src/domain/llm.js";

const RUN = "7f3c2a1e-4b5d-4c6e-8f9a-0b1c2d3e4f5a";

describe("LlmChatRequestSchema", () => {
	const req = {
		target: { tier: "coder" },
		runId: RUN,
		priority: 1,
		needs: ["tool_calling"],
		avoidFamilies: ["qwen"],
		messages: [{ role: "user", content: "hi" }],
		maxTokens: 256,
	};

	it("accepts a tier target or an exact model target", () => {
		expect(LlmChatRequestSchema.parse(req)).toEqual(req);
		const exact = {
			...req,
			target: { providerId: "openrouter", modelId: "m:free" },
		};
		expect(LlmChatRequestSchema.parse(exact)).toEqual(exact);
	});

	it("rejects a model field, an unknown tier, need or priority", () => {
		for (const bad of [
			{ ...req, model: "m" },
			{ ...req, target: { tier: "huge" } },
			{ ...req, target: { providerId: "openrouter" } },
			{ ...req, needs: ["speed"] },
			{ ...req, priority: 3 },
			{ ...req, runId: "" },
		])
			expect(LlmChatRequestSchema.safeParse(bad).success).toBe(false);
	});
});

describe("PrivacyConfigSchema", () => {
	it("defaults allowTraining to false, also for a missing section", () => {
		expect(PrivacyConfigSchema.parse(undefined)).toEqual({
			allowTraining: false,
		});
		expect(PrivacyConfigSchema.parse({ allowTraining: true })).toEqual({
			allowTraining: true,
		});
	});

	it("rejects unknown keys and non-boolean values", () => {
		expect(PrivacyConfigSchema.safeParse({ allow: true }).success).toBe(false);
		expect(
			PrivacyConfigSchema.safeParse({ allowTraining: "yes" }).success,
		).toBe(false);
	});
});
