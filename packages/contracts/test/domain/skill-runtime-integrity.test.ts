import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { SkillSnapshot } from "../../src/domain/skill-runtime.js";
import { skillSnapshotCanonical } from "../../src/domain/skill-runtime-identity.js";
import { checkSkillInventoryIntegrity } from "../../src/domain/skill-runtime-integrity.js";
import type { SkillReceipt } from "../../src/domain/skill-runtime-receipts.js";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const runId = id(1);
const digest = (snapshot: SkillSnapshot) =>
	createHash("sha256").update(skillSnapshotCanonical(snapshot)).digest("hex");
const snapshot = (): SkillSnapshot => {
	const value: SkillSnapshot = {
		receiptId: id(3),
		owner: { runId, contextId: id(2) },
		inspection: {
			source: {
				sourceId: "a".repeat(64),
				scope: "workspace",
				path: "review/SKILL.md",
			},
			metadata: { name: "review", description: "Review changes" },
			text: "\ufeffExact instructions\r\n",
			sha256: "b".repeat(64),
		},
		revision: 1,
		origin: "explicit",
		loadedAt: "2026-11-09T00:00:00Z",
		payloadSha256: "c".repeat(64),
	};
	return { ...value, payloadSha256: digest(value) };
};
const receipt = (value: SkillSnapshot): SkillReceipt => ({
	receiptId: value.receiptId,
	owner: value.owner,
	operationId: id(4),
	version: {
		sourceId: value.inspection.source.sourceId,
		sha256: value.inspection.sha256,
		revision: value.revision,
	},
	origin: value.origin,
	loadedAt: value.loadedAt,
	payloadSha256: value.payloadSha256,
});
const failed = { ok: false, error: { code: "integrity_failed" } };
const checked = (receipts: SkillReceipt[], snapshots: SkillSnapshot[]) =>
	checkSkillInventoryIntegrity(
		{ runId, receipts },
		{ runId, snapshots },
		digest,
	);

describe("complete receipt-to-snapshot integrity", () => {
	it("accepts only matched complete evidence including authoritative empty inventory", () => {
		const value = snapshot();
		expect(checked([], [])).toEqual({ ok: true, value: undefined });
		expect(checked([receipt(value)], [value])).toEqual({
			ok: true,
			value: undefined,
		});
		expect(checked([], [value])).toEqual(failed);
		expect(checked([receipt(value)], [])).toEqual(failed);
	});

	it("refuses self-rehashed content and every changed authenticated field", () => {
		const value = snapshot();
		for (const changed of [
			{ ...value, receiptId: id(9) },
			{ ...value, owner: { ...value.owner, contextId: id(9) } },
			{ ...value, owner: { ...value.owner, taskId: id(8), attemptId: id(9) } },
			{ ...value, revision: 2 },
			{ ...value, origin: "model" as const },
			{ ...value, loadedAt: "2026-11-09T00:00:01Z" },
			{
				...value,
				inspection: { ...value.inspection, text: "Replaced instructions" },
			},
			{
				...value,
				inspection: {
					...value.inspection,
					metadata: { ...value.inspection.metadata, description: "Changed" },
				},
			},
			{
				...value,
				inspection: {
					...value.inspection,
					source: { ...value.inspection.source, path: "other/SKILL.md" },
				},
			},
		])
			expect(
				checked(
					[receipt(value)],
					[{ ...changed, payloadSha256: digest(changed) }],
				),
			).toEqual(failed);
	});

	it("refuses changed receipt bindings even when the saved body and digest are unchanged", () => {
		const value = snapshot();
		const issued = receipt(value);
		for (const changed of [
			{ ...issued, owner: { ...issued.owner, contextId: id(9) } },
			{ ...issued, version: { ...issued.version, sha256: "d".repeat(64) } },
			{ ...issued, version: { ...issued.version, revision: 2 } },
			{ ...issued, origin: "model" as const },
			{ ...issued, loadedAt: "2026-11-09T00:00:01Z" },
			{ ...issued, payloadSha256: "d".repeat(64) },
		])
			expect(checked([changed], [value])).toEqual(failed);
	});

	it("checks all contexts and earlier attempts without imposing a four-per-run limit", () => {
		const values = Array.from({ length: 5 }, (_, index) => {
			const value = {
				...snapshot(),
				receiptId: id(index + 10),
				owner: {
					runId,
					contextId: id(index + 20),
					taskId: id(30),
					attemptId: id(index + 40),
				},
			};
			return { ...value, payloadSha256: digest(value) };
		});
		const receipts = values.map((value, index) => ({
			...receipt(value),
			operationId: id(index + 50),
		}));
		expect(checked(receipts, values)).toEqual({ ok: true, value: undefined });
		expect(checked(receipts, values.slice(1))).toEqual(failed);
		expect(checked(receipts, [...values].reverse())).toEqual({
			ok: true,
			value: undefined,
		});
	});

	it("refuses malformed evidence, foreign runs and failed native digest computation", () => {
		const value = snapshot();
		for (const inventory of [
			undefined,
			{ runId, receipts: null },
			{ runId: id(8), receipts: [] },
			{ runId, receipts: [receipt(value), receipt(value)] },
		])
			expect(
				checkSkillInventoryIntegrity(
					inventory,
					{ runId, snapshots: [value] },
					digest,
				),
			).toEqual(failed);
		expect(
			checkSkillInventoryIntegrity({ runId, receipts: [] }, {}, digest),
		).toEqual(failed);
		expect(
			checkSkillInventoryIntegrity(
				{ runId, receipts: [receipt(value)] },
				{ runId, snapshots: [value] },
				() => {
					throw new Error("private failure");
				},
			),
		).toEqual(failed);
	});
});
