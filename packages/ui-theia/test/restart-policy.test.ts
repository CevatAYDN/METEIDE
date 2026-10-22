import { describe, expect, it } from "vitest";
import { createRestartPolicy } from "../src/domain/restart-policy.js";

describe("restart policy", () => {
	it("allows the limit within the window and then refuses", () => {
		const policy = createRestartPolicy(3, 1000);
		expect([0, 10, 20].map((t) => policy.allow(t))).toEqual([true, true, true]);
		expect(policy.allow(30)).toBe(false);
	});

	it("opens again once the oldest restart leaves the window", () => {
		const policy = createRestartPolicy(2, 1000);
		policy.allow(0);
		policy.allow(500);
		expect(policy.allow(999)).toBe(false);
		expect(policy.allow(1000)).toBe(true);
		expect(policy.allow(1001)).toBe(false);
	});

	it("does not count a refusal as a restart", () => {
		const policy = createRestartPolicy(1, 1000);
		policy.allow(0);
		for (const t of [100, 200, 300]) expect(policy.allow(t)).toBe(false);
		expect(policy.allow(1000)).toBe(true);
	});
});
