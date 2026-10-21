import { describe, expect, it } from "vitest";
import {
	SUPERVISOR_MAX_RESTARTS,
	SUPERVISOR_WINDOW_MS,
} from "../../src/defaults.js";
import { createRestartBudget } from "../../src/domain/restart-budget.js";

const setup = () => {
	let t = 0;
	const budget = createRestartBudget(() => t);
	return { budget, advance: (ms: number) => (t += ms) };
};

describe("createRestartBudget", () => {
	it("allows the maximum restarts in the window, then refuses", () => {
		const { budget } = setup();
		for (let i = 0; i < SUPERVISOR_MAX_RESTARTS; i++)
			expect(budget.take()).toBe(true);
		expect(budget.take()).toBe(false);
	});

	it("allows again once the oldest restart leaves the window", () => {
		const { budget, advance } = setup();
		for (let i = 0; i < SUPERVISOR_MAX_RESTARTS; i++) budget.take();
		advance(SUPERVISOR_WINDOW_MS - 1);
		expect(budget.take()).toBe(false);
		advance(1);
		expect(budget.take()).toBe(true);
	});
});
