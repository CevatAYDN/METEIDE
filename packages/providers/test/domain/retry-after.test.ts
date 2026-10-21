import { describe, expect, it } from "vitest";
import { retryAfter } from "../../src/domain/retry-after.js";

const NOW = Date.parse("2026-10-21T12:00:00Z");
const h = (value?: string) =>
	new Headers(value === undefined ? {} : { "retry-after": value });

describe("retryAfter", () => {
	it("reads delay seconds and HTTP dates", () => {
		expect(retryAfter(h("30"), NOW)).toBe("2026-10-21T12:00:30.000Z");
		expect(retryAfter(h("Wed, 21 Oct 2026 12:05:00 GMT"), NOW)).toBe(
			"2026-10-21T12:05:00.000Z",
		);
	});

	it("gives undefined for a missing or unreadable header", () => {
		expect(retryAfter(h(), NOW)).toBeUndefined();
		expect(retryAfter(h("soon"), NOW)).toBeUndefined();
	});
});
