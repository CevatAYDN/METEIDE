import { describe, expect, expectTypeOf, it } from "vitest";
import type { z } from "zod";
import {
	SkillApproveInputSchema,
	SkillDisableInputSchema,
	type SkillMutationResult,
	SkillMutationResultSchema,
	SkillPreviewSchema,
	SkillSourceInputSchema,
	type SkillTrustAdapter,
	SkillTrustEntrySchema,
	SkillTrustListSchema,
} from "../../src/index.js";

const source = {
	sourceId: "a".repeat(64),
	scope: "workspace",
	path: "review/SKILL.md",
};
const metadata = { name: "review", description: "Review code" };
const approved = {
	source,
	metadata,
	status: "approved",
	revision: 1,
	approvedSha256: "b".repeat(64),
	currentSha256: "b".repeat(64),
	diagnostics: [],
};
const preview = {
	previewId: crypto.randomUUID(),
	inspection: { source, metadata, text: "[MASKED]", sha256: "b".repeat(64) },
	expiresAt: "2026-11-08T12:00:00.000Z",
	revision: 0,
};
const check = (schema: z.ZodType, value: unknown, expected: boolean) => {
	expect(schema.safeParse(value).success).toBe(expected);
};

describe("skill.trust@1", () => {
	it("binds requests to IDs, never replacement claims", () => {
		const prepare = { sourceId: source.sourceId };
		const approve = { previewId: preview.previewId };
		const disable = { ...prepare, expectedRevision: 1 };
		expect(SkillSourceInputSchema.parse(prepare)).toEqual(prepare);
		expect(SkillApproveInputSchema.parse(approve)).toEqual(approve);
		expect(SkillDisableInputSchema.parse(disable)).toEqual(disable);
		for (const field of ["root", "text", "sha256", "idle", "sessionId"]) {
			const claim = { [field]: "replacement" };
			check(SkillSourceInputSchema, { ...prepare, ...claim }, false);
			check(SkillApproveInputSchema, { ...approve, ...claim }, false);
			check(SkillDisableInputSchema, { ...disable, ...claim }, false);
		}
		check(SkillApproveInputSchema, { previewId: "forged" }, false);
		for (const expectedRevision of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1])
			check(SkillDisableInputSchema, { ...disable, expectedRevision }, false);
	});

	it("retains raw identity alongside a masked inspection", () => {
		expect(SkillPreviewSchema.parse(preview)).toEqual(preview);
		for (const bad of [
			{ ...preview, expiresAt: "tomorrow" },
			{ ...preview, revision: -1 },
			{ ...preview, trusted: true },
			{
				...preview,
				inspection: { ...preview.inspection, sha256: "invalid" },
			},
		])
			check(SkillPreviewSchema, bad, false);
	});

	it("rejects false approval and retains missing-source records", () => {
		expect(SkillTrustEntrySchema.parse(approved)).toEqual(approved);
		const missing = { source, status: "missing", revision: 1, diagnostics: [] };
		expect(SkillTrustEntrySchema.parse(missing)).toEqual(missing);
		const priorGrant = { ...missing, approvedSha256: approved.approvedSha256 };
		expect(SkillTrustEntrySchema.parse(priorGrant)).toEqual(priorGrant);
		for (const status of ["unapproved", "invalid", "unavailable"])
			check(SkillTrustEntrySchema, { ...missing, status, revision: 0 }, true);
		const changed = {
			...approved,
			status: "changed",
			currentSha256: "c".repeat(64),
		};
		expect(SkillTrustEntrySchema.parse(changed)).toEqual(changed);
		check(SkillTrustEntrySchema, { ...approved, status: "disabled" }, true);
		for (const bad of [
			{ ...approved, revision: 0 },
			{ ...approved, metadata: undefined },
			{ ...approved, currentSha256: undefined },
			{ ...approved, currentSha256: "c".repeat(64) },
			{ ...approved, diagnostics: [{ code: "unavailable" }] },
			{ ...approved, status: "loaded" },
			{ ...approved, status: "changed" },
			{ ...approved, status: "missing" },
			{ ...approved, revision: -1 },
			{ ...approved, approvedSha256: "invalid" },
		])
			check(SkillTrustEntrySchema, bad, false);
	});

	it("keeps historical inventories explicit and source-qualified", () => {
		const entries = Array.from({ length: 129 }, (_, i) => ({
			source: {
				...source,
				sourceId: i.toString(16).padStart(64, "0"),
			},
			status: "missing",
			revision: 1,
			diagnostics: [],
		}));
		const list = { entries, complete: true, diagnostics: [] };
		expect(SkillTrustListSchema.parse(list).entries).toHaveLength(129);
		check(SkillTrustListSchema, { ...list, complete: undefined }, false);
		check(
			SkillTrustListSchema,
			{ ...list, entries: [approved, approved] },
			false,
		);
		const limited = { ...list, diagnostics: [{ code: "limit_exceeded" }] };
		check(SkillTrustListSchema, limited, false);
		check(SkillTrustListSchema, { ...limited, complete: false }, true);
	});

	it("retains admission on failure; rejects unadmitted success", () => {
		const success = { admitted: true, result: { ok: true, value: approved } };
		expect(SkillMutationResultSchema.parse(success)).toEqual(success);
		for (const admitted of [false, true]) {
			const failure = {
				admitted,
				result: { ok: false, error: { code: "stale" } },
			};
			expect(SkillMutationResultSchema.parse(failure)).toEqual(failure);
		}
		for (const bad of [
			{ ...success, admitted: false },
			{ result: success.result },
			{
				...success,
				result: { ok: false, error: { code: "stale", message: "secret" } },
			},
			{
				...success,
				result: { ...success.result, error: { code: "stale" } },
			},
		])
			check(SkillMutationResultSchema, bad, false);
		expectTypeOf<SkillTrustAdapter["approve"]>().returns.toEqualTypeOf<
			Promise<SkillMutationResult>
		>();
		expectTypeOf<SkillTrustAdapter["disable"]>().returns.toEqualTypeOf<
			Promise<SkillMutationResult>
		>();
	});
});
