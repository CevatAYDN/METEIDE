import { describe, expect, it } from "vitest";
import {
	SkillLoadOutputSchema,
	SkillRuntimeCatalogResultSchema,
	SkillRuntimeCheckInputSchema,
	SkillRuntimeCheckResultSchema,
	SkillRuntimeInventoryInputSchema,
	SkillRuntimeInventoryResultSchema,
	SkillRuntimeLoadResultSchema,
} from "../../src/domain/skill-runtime-port.js";

const runId = "00000000-0000-4000-8000-000000000001";
const contextId = "00000000-0000-4000-8000-000000000002";
const receiptId = "00000000-0000-4000-8000-000000000003";
const sourceId = "a".repeat(64);
const sha256 = "b".repeat(64);
const loadedAt = "2026-11-08T20:00:00.000Z";
const snapshot = () => ({
	receiptId,
	owner: { runId, contextId },
	inspection: {
		source: { sourceId, scope: "workspace" as const, path: "review/SKILL.md" },
		metadata: { name: "review", description: "Review changes." },
		text: "Approved instructions",
		sha256,
	},
	revision: 1,
	origin: "explicit" as const,
	loadedAt,
	payloadSha256: "c".repeat(64),
});

describe("runtime port boundaries", () => {
	it("requires an exact run identity without caller-owned authority", () => {
		expect(SkillRuntimeInventoryInputSchema.parse({ runId })).toEqual({
			runId,
		});
		for (const extra of [{ workspaceKey: sourceId }, { trusted: true }]) {
			expect(
				SkillRuntimeInventoryInputSchema.safeParse({ runId, ...extra }).success,
			).toBe(false);
		}
		expect(SkillRuntimeInventoryInputSchema.safeParse({}).success).toBe(false);
	});

	it("checks all retained contexts without imposing four snapshots per run", () => {
		const snapshots = Array.from({ length: 5 }, (_, index) => ({
			...snapshot(),
			receiptId: `00000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`,
			owner: {
				runId,
				contextId: `00000000-0000-4000-8000-${String(index + 20).padStart(12, "0")}`,
			},
		}));
		expect(
			SkillRuntimeCheckInputSchema.safeParse({ runId, snapshots }).success,
		).toBe(true);
		expect(
			SkillRuntimeCheckInputSchema.safeParse({ runId, snapshots: [] }).success,
		).toBe(true);
	});

	it("rejects foreign runs, repeated receipts and mixed owners", () => {
		const original = snapshot();
		for (const changed of [
			{ ...original, owner: { ...original.owner, runId: receiptId } },
			{ ...original, owner: { runId, contextId: receiptId } },
			{
				...original,
				receiptId: contextId,
				owner: { ...original.owner, taskId: receiptId, attemptId: runId },
			},
		]) {
			expect(
				SkillRuntimeCheckInputSchema.safeParse({
					runId,
					snapshots: [original, changed],
				}).success,
			).toBe(false);
		}
	});

	it("preserves each context's complete body budget and unique sources", () => {
		const original = snapshot();
		const changed = {
			...original,
			receiptId: contextId,
			inspection: {
				...original.inspection,
				source: { ...original.inspection.source, sourceId: sha256 },
			},
		};
		expect(
			SkillRuntimeCheckInputSchema.safeParse({
				runId,
				snapshots: [original, changed],
			}).success,
		).toBe(true);
		changed.inspection.text = "x".repeat(65_536);
		expect(
			SkillRuntimeCheckInputSchema.safeParse({
				runId,
				snapshots: [original, changed],
			}).success,
		).toBe(false);
		changed.inspection.text = original.inspection.text;
		changed.inspection.source.sourceId = sourceId;
		expect(
			SkillRuntimeCheckInputSchema.safeParse({
				runId,
				snapshots: [original, changed],
			}).success,
		).toBe(false);
	});

	it("returns model receipt metadata only, never an instruction body", () => {
		const value = {
			receiptId,
			version: { sourceId, sha256, revision: 1 },
			origin: "explicit",
			loadedAt,
		};
		expect(SkillLoadOutputSchema.parse(value)).toEqual(value);
		for (const extra of [
			{ text: "body" },
			{ inspection: snapshot().inspection },
		])
			expect(
				SkillLoadOutputSchema.safeParse({ ...value, ...extra }).success,
			).toBe(false);
	});

	it("parses strict Result envelopes without treating broken evidence as empty", () => {
		expect(
			SkillRuntimeInventoryResultSchema.parse({
				ok: true,
				value: { runId, receipts: [] },
			}).ok,
		).toBe(true);
		expect(
			SkillRuntimeLoadResultSchema.parse({ ok: true, value: snapshot() }).ok,
		).toBe(true);
		expect(
			SkillRuntimeCatalogResultSchema.parse({
				ok: true,
				value: { status: "ready", entries: [], diagnostics: [] },
			}).ok,
		).toBe(true);
		expect(
			SkillRuntimeCheckResultSchema.parse({ ok: true, value: undefined }).ok,
		).toBe(true);
		for (const schema of [
			SkillRuntimeInventoryResultSchema,
			SkillRuntimeCatalogResultSchema,
			SkillRuntimeLoadResultSchema,
			SkillRuntimeCheckResultSchema,
		]) {
			expect(
				schema.parse({ ok: false, error: { code: "integrity_failed" } }).ok,
			).toBe(false);
			expect(
				schema.safeParse({
					ok: false,
					error: { code: "integrity_failed", message: "body" },
				}).success,
			).toBe(false);
			expect(schema.safeParse({ ok: true, value: null }).success).toBe(false);
			expect(schema.safeParse({ ok: true, value: [] }).success).toBe(false);
		}
	});
});
