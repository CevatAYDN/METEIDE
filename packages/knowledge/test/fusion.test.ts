import { describe, expect, it } from "vitest";
import { fuse } from "../src/domain/fusion.js";

// Reciprocal Rank Fusion of the keyword and vector sources (docs/11, Hybrid search; ADR-152).

describe("fuse", () => {
	it("ranks first what both sources found, then cuts to k", () => {
		expect(fuse(["a", "b", "c"], ["c", "d"], 4)).toEqual(["c", "a", "b", "d"]);
		expect(fuse(["a", "b", "c"], ["c", "d"], 2)).toEqual(["c", "a"]);
	});

	it("breaks a tie by the keyword rank, then by the vector rank", () => {
		expect(fuse(["a"], ["x"], 5)).toEqual(["a", "x"]);
		expect(fuse(["b", "c"], ["c", "b"], 5)).toEqual(["b", "c"]);
	});

	it("keeps one source's order when the other found nothing", () => {
		expect(fuse(["a", "b"], [], 5)).toEqual(["a", "b"]);
		expect(fuse([], ["x", "y"], 1)).toEqual(["x"]);
	});
});
