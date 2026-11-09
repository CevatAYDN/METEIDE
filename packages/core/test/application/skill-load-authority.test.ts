import type { SkillRuntimeLoadInput } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import { createSkillLoadAuthority } from "../../src/application/skill-load-authority.js";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const input = (): SkillRuntimeLoadInput => ({
	owner: { runId: id(1), contextId: id(2) },
	operationId: id(3),
	version: { sourceId: "a".repeat(64), sha256: "b".repeat(64), revision: 1 },
	origin: "model",
});
const op = (
	over: Partial<
		Parameters<ReturnType<typeof createSkillLoadAuthority>["begin"]>[0]
	> = {},
) => {
	const value = input();
	return {
		input: value,
		live: () => true,
		retainedBytes: 0,
		retainedCount: 0,
		...over,
	};
};

describe("native skill load authority", () => {
	it("admits only the exact registered input object", () => {
		const a = createSkillLoadAuthority();
		const o = op();
		a.begin(o);
		expect(a.admission.live(o.input)).toBe(true);
		expect(a.admission.live(input())).toBe(false);
	});

	it("stops admitting after release or when the operation is no longer live", () => {
		const a = createSkillLoadAuthority();
		const state = { live: true };
		const o = op({ live: () => state.live });
		const release = a.begin(o);
		state.live = false;
		expect(a.admission.live(o.input)).toBe(false);
		state.live = true;
		release();
		expect(a.admission.live(o.input)).toBe(false);
	});

	it("treats a throwing liveness probe as retired", () => {
		const a = createSkillLoadAuthority();
		const o = op({
			live: () => {
				throw new Error("gone");
			},
		});
		a.begin(o);
		expect(a.admission.live(o.input)).toBe(false);
		expect(a.admission.fits(o.input, 1)).toBe(false);
	});

	it("checks the retained context budget before any receipt", () => {
		const a = createSkillLoadAuthority();
		const o = op({ retainedBytes: 65_000, retainedCount: 3 });
		a.begin(o);
		expect(a.admission.fits(o.input, 536)).toBe(true);
		expect(a.admission.fits(o.input, 537)).toBe(false);
		expect(a.admission.fits(o.input, -1)).toBe(false);
		expect(a.admission.fits(o.input, Number.NaN)).toBe(false);
	});

	it("refuses a fifth snapshot in one context", () => {
		const a = createSkillLoadAuthority();
		const o = op({ retainedCount: 4 });
		a.begin(o);
		expect(a.admission.fits(o.input, 1)).toBe(false);
	});

	it("does not let a stale release remove a newer registration", () => {
		const a = createSkillLoadAuthority();
		const o = op();
		const stale = a.begin(o);
		const fresh = { ...o, live: () => true };
		a.begin(fresh);
		stale();
		expect(a.admission.live(o.input)).toBe(true);
	});
});
