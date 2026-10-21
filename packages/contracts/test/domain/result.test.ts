import { describe, expect, it } from "vitest";
import { err, ok } from "../../src/domain/result.js";

describe("Result", () => {
	it("ok wraps a value", () => {
		expect(ok(3)).toEqual({ ok: true, value: 3 });
	});

	it("err wraps an error with a code", () => {
		const r = err({ code: "not_found" as const });
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.code).toBe("not_found");
	});
});
