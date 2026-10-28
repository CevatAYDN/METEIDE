import { describe, expect, it } from "vitest";
import { KnowledgeSearchInputSchema } from "../../src/domain/knowledge.js";

// knowledge.search@1 (docs/11, Hybrid search; ADR-149).

describe("knowledge.search@1 input", () => {
	it("searches both vaults for 8 results unless told otherwise", () => {
		expect(KnowledgeSearchInputSchema.parse({ query: "tests" })).toEqual({
			query: "tests",
			scope: "all",
			k: 8,
		});
		expect(
			KnowledgeSearchInputSchema.parse({
				query: "tests",
				scope: "workspace",
				k: 30,
				type: "inbox",
				path: "lessons/",
			}),
		).toEqual({
			query: "tests",
			scope: "workspace",
			k: 30,
			type: "inbox",
			path: "lessons/",
		});
	});

	it("refuses a blank query, k outside 1 to 30, an unknown type or key", () => {
		for (const bad of [
			{ query: " " },
			{ query: "a", k: 0 },
			{ query: "a", k: 31 },
			{ query: "a", k: 2.5 },
			{ query: "a", type: "note" },
			{ query: "a", extra: 1 },
		])
			expect(KnowledgeSearchInputSchema.safeParse(bad).success).toBe(false);
	});
});
