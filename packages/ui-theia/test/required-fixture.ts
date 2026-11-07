import { ok } from "node:assert/strict";

/** Missing fixtures and callbacks must fail the test, never silently skip its action. */
export const required = <T>(value: T | null | undefined): T => {
	ok(value !== undefined && value !== null, "Required test fixture is missing");
	return value;
};
