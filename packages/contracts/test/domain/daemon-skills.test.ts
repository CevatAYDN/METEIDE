import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
	DaemonSkillsApproveParamsSchema,
	DaemonSkillsApproveResultSchema,
	DaemonSkillsDisableParamsSchema,
	DaemonSkillsDisableResultSchema,
	DaemonSkillsListParamsSchema,
	DaemonSkillsListResultSchema,
	DaemonSkillsPrepareParamsSchema,
	DaemonSkillsPrepareResultSchema,
	SkillErrorSchema,
	SkillMutationResultSchema,
} from "../../src/index.js";

const sessionId = crypto.randomUUID();
const sourceId = "a".repeat(64);
const previewId = crypto.randomUUID();
const list = { sessionId, entries: [], complete: true, diagnostics: [] };
const preview = {
	sessionId,
	previewId,
	inspection: {
		source: { sourceId, scope: "workspace", path: "review/SKILL.md" },
		metadata: { name: "review", description: "Review code" },
		text: "[MASKED]",
		sha256: "b".repeat(64),
	},
	expiresAt: "2026-11-08T12:00:00.000Z",
	revision: 0,
};
const check = (schema: z.ZodType, value: unknown, expected: boolean) => {
	expect(schema.safeParse(value).success).toBe(expected);
};

describe("daemon skill management", () => {
	it("requires instance identity after list, never caller admission", () => {
		expect(DaemonSkillsListParamsSchema.parse({})).toEqual({});
		check(DaemonSkillsListParamsSchema, { sessionId }, false);
		const requests = [
			{ schema: DaemonSkillsPrepareParamsSchema, input: { sourceId } },
			{ schema: DaemonSkillsApproveParamsSchema, input: { previewId } },
			{
				schema: DaemonSkillsDisableParamsSchema,
				input: { sourceId, expectedRevision: 1 },
			},
		];
		for (const { schema, input } of requests) {
			const request = { sessionId, ...input };
			expect(schema.parse(request)).toEqual(request);
			check(schema, input, false);
			check(schema, { ...request, sessionId: "workspace" }, false);
			for (const claim of ["root", "text", "sha256", "idle", "admitted"])
				check(schema, { ...request, [claim]: true }, false);
		}
	});

	it("returns session-bound success, never bare payload substitutes", () => {
		const cases = [
			{ schema: DaemonSkillsListResultSchema, value: list },
			{ schema: DaemonSkillsPrepareResultSchema, value: preview },
		];
		for (const { schema, value } of cases) {
			const success = { ok: true, value };
			expect(schema.parse(success)).toEqual(success);
			check(schema, value, false);
			check(
				schema,
				{ ok: true, value: { ...value, sessionId: undefined } },
				false,
			);
			check(schema, { ...success, error: { code: "stale" } }, false);
		}
		check(
			DaemonSkillsListResultSchema,
			{
				ok: true,
				value: { ...list, diagnostics: [{ code: "limit_exceeded" }] },
			},
			false,
		);
	});

	it("preserves every safe typed failure on list and prepare", () => {
		for (const code of SkillErrorSchema.shape.code.options) {
			const failure = {
				ok: false,
				error: { code, sourceId, location: "source" },
			};
			expect(DaemonSkillsListResultSchema.parse(failure)).toEqual(failure);
			expect(DaemonSkillsPrepareResultSchema.parse(failure)).toEqual(failure);
		}
		for (const schema of [
			DaemonSkillsListResultSchema,
			DaemonSkillsPrepareResultSchema,
		]) {
			for (const error of [
				{ code: "failed" },
				{ code: "unavailable", message: "secret" },
				{ code: "unavailable", location: "/secret" },
			])
				check(schema, { ok: false, error }, false);
		}
	});

	it("reuses authoritative admission for post-guard errors", () => {
		expect(DaemonSkillsApproveResultSchema).toBe(SkillMutationResultSchema);
		expect(DaemonSkillsDisableResultSchema).toBe(SkillMutationResultSchema);
		for (const schema of [
			DaemonSkillsApproveResultSchema,
			DaemonSkillsDisableResultSchema,
		]) {
			const failure = {
				admitted: true,
				result: { ok: false, error: { code: "expired" } },
			};
			expect(schema.parse(failure)).toEqual(failure);
			check(schema, { ...failure, admitted: false }, true);
			check(schema, { result: failure.result }, false);
			check(schema, { ...failure, result: { ok: true, value: {} } }, false);
		}
	});
});
