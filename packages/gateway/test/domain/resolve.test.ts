import type { ModelInfo, Privacy } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import {
	type Discovered,
	type PrivacyRules,
	privacyBlocked,
	resolveChain,
} from "../../src/domain/resolve.js";

const SAFE: Privacy = { trains: false, logs: true, publishes: false };
const TRAINS: Privacy = { trains: true, logs: true, publishes: false };
const UNKNOWN: Privacy = {
	trains: "unknown",
	logs: "unknown",
	publishes: false,
};

const model = (
	id: string,
	over: Partial<ModelInfo> = {},
	privacy: Privacy = SAFE,
): Discovered => ({
	model: {
		id,
		providerId: "p",
		family: id,
		contextWindow: 64_000,
		toolCalling: true,
		vision: false,
		free: true,
		deprecated: false,
		...over,
	},
	privacy,
});

const DEFAULT: PrivacyRules = { allowTraining: false, sensitive: false };
const ids = (chain: readonly ModelInfo[]) => chain.map((m) => m.id);

describe("resolveChain for a tier", () => {
	it("keeps every free, current model that meets the tier, larger context first", () => {
		const found = [
			model("small", { contextWindow: 16_000 }),
			model("a", { contextWindow: 40_000 }),
			model("paid", { free: false }),
			model("old", { deprecated: true }),
			model("b", { contextWindow: 200_000 }),
			model("c"),
			model("d", { contextWindow: 33_000 }),
			model("e", { contextWindow: 32_000 }),
		];
		expect(ids(resolveChain(found, { tier: "reasoning" }, DEFAULT))).toEqual([
			"b",
			"c",
			"a",
			"d",
			"e",
		]);
	});

	it("asks the coder tier for known tool calling and the vision tier for known image input", () => {
		const found = [
			model("tools"),
			model("maybe", { toolCalling: "unknown" }),
			model("sees", { vision: true }),
			// ADR-060: vision also needs 32k of context.
			model("squint", { vision: true, contextWindow: 4_000 }),
			model("blurry", { vision: "unknown" }),
		];
		expect(ids(resolveChain(found, { tier: "coder" }, DEFAULT))).toEqual([
			"tools",
			"sees",
			"blurry",
		]);
		expect(ids(resolveChain(found, { tier: "vision" }, DEFAULT))).toEqual([
			"sees",
		]);
	});

	it("applies the role's needs on top of the tier", () => {
		const found = [
			model("plain", { toolCalling: false }),
			model("long", { contextWindow: 128_000, vision: true }),
		];
		const fast = { tier: "fast" } as const;
		expect(
			ids(resolveChain(found, fast, DEFAULT, { needs: ["tool_calling"] })),
		).toEqual(["long"]);
		expect(
			ids(resolveChain(found, fast, DEFAULT, { needs: ["long_context"] })),
		).toEqual(["long"]);
		expect(
			ids(resolveChain(found, fast, DEFAULT, { needs: ["vision"] })),
		).toEqual(["long"]);
	});

	it("drops avoided families only while other candidates remain", () => {
		const found = [
			model("x", { family: "qwen", contextWindow: 100_000 }),
			model("y", { family: "glm" }),
		];
		const tier = { tier: "reasoning" } as const;
		expect(
			ids(resolveChain(found, tier, DEFAULT, { avoidFamilies: ["qwen"] })),
		).toEqual(["y"]);
		expect(
			ids(
				resolveChain(found, tier, DEFAULT, { avoidFamilies: ["qwen", "glm"] }),
			),
		).toEqual(["x", "y"]);
	});

	it("is empty when nothing fits", () => {
		expect(resolveChain([], { tier: "fast" }, DEFAULT)).toEqual([]);
	});
});

describe("resolveChain with a pinned model (ADR-077)", () => {
	const tier = { tier: "reasoning" } as const;
	const found = [
		model("big", { contextWindow: 200_000 }),
		model("small", { contextWindow: 32_000, family: "qwen" }),
		model("paid", { free: false, price: { input: 1, output: 2 } }),
	];
	const pin = (modelId: string) => ({ providerId: "p", modelId });

	it("puts the pinned candidate first and keeps the rest in their order", () => {
		expect(
			ids(resolveChain(found, tier, DEFAULT, { prefer: pin("small") })),
		).toEqual(["small", "big"]);
	});

	it("leads with the pin even when its family is avoided", () => {
		expect(
			ids(
				resolveChain(found, tier, DEFAULT, {
					prefer: pin("small"),
					avoidFamilies: ["qwen"],
				}),
			),
		).toEqual(["small", "big"]);
	});

	it("ignores a pin that is no candidate: unknown, paid in free mode, or short of the needs", () => {
		const plain = ids(resolveChain(found, tier, DEFAULT));
		for (const prefer of [
			pin("gone"),
			pin("paid"),
			{ providerId: "q", modelId: "big" },
		])
			expect(ids(resolveChain(found, tier, DEFAULT, { prefer }))).toEqual(
				plain,
			);
		const noTools = [model("a"), model("b", { toolCalling: false })];
		expect(
			ids(
				resolveChain(noTools, tier, DEFAULT, {
					prefer: pin("b"),
					needs: ["tool_calling"],
				}),
			),
		).toEqual(["a"]);
	});

	it("leads with a paid pin when the mode admits paid models", () => {
		const both = { ...DEFAULT, mode: "both" } as const;
		expect(
			ids(resolveChain(found, tier, both, { prefer: pin("paid") }))[0],
		).toBe("paid");
	});

	it("is ignored for an exact model target", () => {
		const exact = { providerId: "p", modelId: "big" };
		expect(
			ids(resolveChain(found, exact, DEFAULT, { prefer: pin("small") })),
		).toEqual(["big"]);
	});
});

describe("resolveChain privacy filter", () => {
	const found = [
		model("safe"),
		model("trains", {}, TRAINS),
		model("unknown", {}, UNKNOWN),
	];
	const tier = { tier: "fast" } as const;

	it("excludes models that train, publish or have unknown facts by default", () => {
		expect(ids(resolveChain(found, tier, DEFAULT))).toEqual(["safe"]);
		const publishes = model("pub", {}, { ...SAFE, publishes: "unknown" });
		expect(ids(resolveChain([publishes], tier, DEFAULT))).toEqual([]);
	});

	it("admits them when the user allows training", () => {
		const allow = { allowTraining: true, sensitive: false };
		expect(ids(resolveChain(found, tier, allow))).toEqual([
			"safe",
			"trains",
			"unknown",
		]);
	});

	it("keeps a sensitive workspace strict even when training is allowed", () => {
		const strict = { allowTraining: true, sensitive: true };
		expect(ids(resolveChain(found, tier, strict))).toEqual(["safe"]);
	});
});

describe("privacyBlocked", () => {
	const of = (providerId: string, id: string, privacy: Privacy) =>
		model(id, { providerId }, privacy);

	it("names a provider whose current models all fail the privacy filter", () => {
		const found = [
			of("g", "a", TRAINS),
			of("g", "b", UNKNOWN),
			of("ok", "c", SAFE),
			of("mixed", "d", TRAINS),
			of("mixed", "e", SAFE),
			of("old", "f", TRAINS),
		];
		found[5] = model("f", { providerId: "old", deprecated: true }, TRAINS);
		expect(privacyBlocked(found, DEFAULT)).toEqual(["g"]);
	});

	it("names nothing once training is allowed, or for a provider with no model of the mode", () => {
		const found = [
			of("g", "a", TRAINS),
			model("p", { providerId: "paid", free: false }, TRAINS),
		];
		expect(
			privacyBlocked(found, { allowTraining: true, sensitive: false }),
		).toEqual([]);
		expect(privacyBlocked(found, DEFAULT)).toEqual(["g"]);
		expect(
			privacyBlocked(found, { allowTraining: true, sensitive: true }),
		).toEqual(["g"]);
	});
});

describe("resolveChain for an exact model", () => {
	const found = [
		model("small", { contextWindow: 1_000, toolCalling: false }),
		model("paid", { free: false }),
		model("trains", {}, TRAINS),
	];

	it("is that one model, without tier requirements or needs", () => {
		const chain = resolveChain(
			found,
			{ providerId: "p", modelId: "small" },
			DEFAULT,
			{ needs: ["tool_calling"] },
		);
		expect(ids(chain)).toEqual(["small"]);
	});

	it("is empty for an unknown, paid or privacy-excluded model", () => {
		for (const modelId of ["nope", "paid", "trains"])
			expect(
				resolveChain(found, { providerId: "p", modelId }, DEFAULT),
			).toEqual([]);
		expect(
			resolveChain(found, { providerId: "q", modelId: "small" }, DEFAULT),
		).toEqual([]);
	});
});
