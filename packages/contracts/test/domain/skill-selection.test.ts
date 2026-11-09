import { describe, expect, it } from "vitest";
import {
	SkillSelectionInputSchema,
	SkillSelectionResultSchema,
} from "../../src/domain/skill-selection.js";

const version = {
	sourceId: "a".repeat(64),
	sha256: "b".repeat(64),
	revision: 1,
};

describe("receipt-free exact skill selection", () => {
	it("retains the complete ordered set and accepts an explicit empty set", () => {
		expect(SkillSelectionInputSchema.parse({ selected: [] })).toEqual({
			selected: [],
		});
		const selected = [
			{ ...version, sourceId: "c".repeat(64), revision: 3 },
			version,
		];
		expect(SkillSelectionInputSchema.parse({ selected })).toEqual({ selected });
	});

	it("bounds each set at four distinct sources without dropping a version", () => {
		const selected = Array.from({ length: 5 }, (_, i) => ({
			...version,
			sourceId: String(i).repeat(64),
		}));
		expect(
			SkillSelectionInputSchema.parse({ selected: selected.slice(0, 4) }),
		).toEqual({ selected: selected.slice(0, 4) });
		expect(SkillSelectionInputSchema.safeParse({ selected }).success).toBe(
			false,
		);
		for (const duplicate of [
			version,
			{ ...version, revision: 2 },
			{ ...version, sha256: "d".repeat(64) },
		])
			expect(
				SkillSelectionInputSchema.safeParse({
					selected: [version, duplicate],
				}).success,
			).toBe(false);
	});

	it("accepts no body, claimed size, owner, root, session or trust assertion", () => {
		for (const extra of [
			{ text: "instructions" },
			{ bytes: 1 },
			{ owner: {} },
			{ root: "/private" },
			{ sessionId: crypto.randomUUID() },
			{ trusted: true },
			{ origin: "explicit" },
		])
			expect(
				SkillSelectionInputSchema.safeParse({
					selected: [version],
					...extra,
				}).success,
			).toBe(false);
		expect(SkillSelectionInputSchema.safeParse({}).success).toBe(false);
		for (const invalid of [
			{ ...version, revision: 0 },
			{ ...version, sha256: "A".repeat(64) },
			{ ...version, sourceId: "invalid" },
			{ ...version, body: "instructions" },
		])
			expect(
				SkillSelectionInputSchema.safeParse({ selected: [invalid] }).success,
			).toBe(false);
	});

	it("returns no reusable content or authority and retains typed refusals", () => {
		expect(SkillSelectionResultSchema.parse({ ok: true, value: null })).toEqual(
			{
				ok: true,
				value: null,
			},
		);
		for (const code of ["revoked", "budget_exceeded", "stale", "aborted"])
			expect(
				SkillSelectionResultSchema.parse({ ok: false, error: { code } }),
			).toEqual({ ok: false, error: { code } });
		for (const value of [
			{},
			[],
			{ text: "instructions" },
			{ receiptId: crypto.randomUUID() },
			{ trusted: true },
		])
			expect(
				SkillSelectionResultSchema.safeParse({ ok: true, value }).success,
			).toBe(false);
		expect(
			SkillSelectionResultSchema.safeParse({
				ok: false,
				error: { code: "stale", message: "private content" },
			}).success,
		).toBe(false);
	});
});
