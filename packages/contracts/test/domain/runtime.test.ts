import { describe, expect, it } from "vitest";
import { RuntimeEnsureInputSchema } from "../../src/domain/runtime.js";

const sha256 = "a".repeat(64);

describe("runtime.ensure@1", () => {
	it("takes a managed runtime by name and a binary only with an https url and its hash", () => {
		for (const runtime of ["node", "python", "container"])
			expect(RuntimeEnsureInputSchema.safeParse({ runtime }).success).toBe(
				true,
			);
		const url = "https://example.com/tool.zip";
		expect(
			RuntimeEnsureInputSchema.safeParse({ runtime: "binary", url, sha256 })
				.success,
		).toBe(true);
		for (const bad of [
			{ runtime: "binary", url },
			{ runtime: "binary", url: "http://example.com/tool.zip", sha256 },
			{ runtime: "binary", url, sha256: "A".repeat(64) },
			{ runtime: "node", url },
			{ runtime: "java" },
		])
			expect(RuntimeEnsureInputSchema.safeParse(bad).success).toBe(false);
	});
});
