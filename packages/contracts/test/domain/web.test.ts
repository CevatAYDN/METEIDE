import { describe, expect, it } from "vitest";
import {
	WebFetchInputSchema,
	WebSearchInputSchema,
} from "../../src/domain/web.js";

describe("web.fetch@1 and web.search@1 input", () => {
	it("takes an http or https url only", () => {
		expect(
			WebFetchInputSchema.safeParse({ url: "https://a.org/x" }).success,
		).toBe(true);
		for (const url of ["file:///etc/passwd", "ftp://a.org", "not a url"])
			expect(WebFetchInputSchema.safeParse({ url }).success).toBe(false);
	});

	it("defaults maxResults to 8 and refuses an empty query", () => {
		expect(WebSearchInputSchema.parse({ query: "free models" })).toEqual({
			query: "free models",
			maxResults: 8,
		});
		expect(WebSearchInputSchema.safeParse({ query: " " }).success).toBe(false);
	});
});
