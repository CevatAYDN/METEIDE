import { describe, expect, it } from "vitest";
import {
	CIRCUIT_FAILURE_LIMIT,
	CIRCUIT_HALF_OPEN_MS,
} from "../../src/defaults.js";
import { createCircuitBreaker } from "../../src/domain/circuit-breaker.js";

const setup = () => {
	let t = 0;
	const breaker = createCircuitBreaker(() => t);
	const fail = (n: number) => {
		for (let i = 0; i < n; i++) breaker.failure();
	};
	return { breaker, fail, advance: (ms: number) => (t += ms) };
};

describe("createCircuitBreaker", () => {
	it("opens after the failure limit in a row, not before", () => {
		const { breaker, fail } = setup();
		fail(CIRCUIT_FAILURE_LIMIT - 1);
		expect(breaker.isOpen()).toBe(false);
		fail(1);
		expect(breaker.isOpen()).toBe(true);
	});

	it("counts only consecutive failures", () => {
		const { breaker, fail } = setup();
		fail(CIRCUIT_FAILURE_LIMIT - 1);
		breaker.success();
		fail(CIRCUIT_FAILURE_LIMIT - 1);
		expect(breaker.isOpen()).toBe(false);
	});

	it("lets a trial call through once the half-open delay passes", () => {
		const { breaker, fail, advance } = setup();
		fail(CIRCUIT_FAILURE_LIMIT);
		advance(CIRCUIT_HALF_OPEN_MS - 1);
		expect(breaker.isOpen()).toBe(true);
		advance(1);
		expect(breaker.isOpen()).toBe(false);
	});

	it("reopens for a full delay when the half-open trial fails", () => {
		const { breaker, fail, advance } = setup();
		fail(CIRCUIT_FAILURE_LIMIT);
		advance(CIRCUIT_HALF_OPEN_MS);
		fail(1);
		expect(breaker.isOpen()).toBe(true);
		advance(CIRCUIT_HALF_OPEN_MS - 1);
		expect(breaker.isOpen()).toBe(true);
	});

	it("keeps the original delay when a call fails while fully open", () => {
		const { breaker, fail, advance } = setup();
		fail(CIRCUIT_FAILURE_LIMIT);
		advance(CIRCUIT_HALF_OPEN_MS - 1);
		fail(1);
		advance(1);
		expect(breaker.isOpen()).toBe(false);
	});

	it("closes when the half-open trial succeeds", () => {
		const { breaker, fail, advance } = setup();
		fail(CIRCUIT_FAILURE_LIMIT);
		advance(CIRCUIT_HALF_OPEN_MS);
		breaker.success();
		fail(CIRCUIT_FAILURE_LIMIT - 1);
		expect(breaker.isOpen()).toBe(false);
	});
});
