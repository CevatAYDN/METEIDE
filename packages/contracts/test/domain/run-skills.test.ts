import { describe, expect, it } from "vitest";
import {
	RunSkillsReadInputSchema,
	RunSkillsReadResultSchema,
	skillLoadedMetadata,
} from "../../src/domain/run-skills.js";
import type { SkillSnapshot } from "../../src/domain/skill-runtime.js";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const runId = id(1);
const owner = { runId, contextId: id(2) };
const snapshot: SkillSnapshot = {
	receiptId: id(3),
	owner,
	inspection: {
		source: {
			sourceId: "a".repeat(64),
			scope: "workspace",
			path: "review/SKILL.md",
		},
		metadata: { name: "review", description: "Review changes" },
		text: "Approved instructions",
		sha256: "b".repeat(64),
	},
	revision: 1,
	origin: "explicit",
	loadedAt: "2026-11-09T00:00:00Z",
	payloadSha256: "c".repeat(64),
};
const policy = {
	mode: "manual" as const,
	selected: [skillLoadedMetadata(snapshot).version],
};
const context = {
	owner,
	roleId: "assistant",
	policy,
	status: "loaded",
	loaded: [skillLoadedMetadata(snapshot)],
};
const detail = { kind: "context", runId, context, snapshots: [snapshot] };

describe("authoritative run skill reads", () => {
	it("requires an exact run and optional context without authority claims", () => {
		expect(RunSkillsReadInputSchema.parse({ runId })).toEqual({ runId });
		expect(
			RunSkillsReadInputSchema.parse({ runId, contextId: owner.contextId }),
		).toEqual({ runId, contextId: owner.contextId });
		for (const input of [
			{},
			{ runId: "invalid" },
			{ runId, contextId: "" },
			{ runId, trusted: true },
			{ runId, snapshots: [] },
		])
			expect(RunSkillsReadInputSchema.safeParse(input).success).toBe(false);
	});

	it("distinguishes confirmed legacy from a complete metadata-only S2 summary", () => {
		expect(RunSkillsReadResultSchema.parse({ kind: "legacy", runId })).toEqual({
			kind: "legacy",
			runId,
		});
		const summary = {
			kind: "summary",
			runId,
			policy: {
				mode: "manual",
				roles: [{ roleId: "assistant", selected: policy.selected }],
			},
			contexts: [context],
		};
		expect(RunSkillsReadResultSchema.parse(summary)).toEqual(summary);
		const blocked = { ...summary, block: { code: "unavailable" } };
		expect(RunSkillsReadResultSchema.parse(blocked)).toEqual(blocked);
		for (const invalid of [
			{ kind: "legacy", runId, contexts: [context] },
			{ ...summary, snapshots: [snapshot] },
			{ ...summary, contexts: [context, context] },
			{
				...summary,
				contexts: [{ ...context, owner: { ...owner, runId: id(9) } }],
			},
			{ ...summary, policy: { mode: "manual", roles: [] } },
			{
				...summary,
				contexts: [
					context,
					{ ...context, owner: { ...owner, contextId: id(9) } },
				],
			},
		])
			expect(RunSkillsReadResultSchema.safeParse(invalid).success).toBe(false);
	});

	it("returns the full retained text only for one exact authenticated context", () => {
		expect(RunSkillsReadResultSchema.parse(detail)).toEqual(detail);
		const blocked = { ...detail, block: { code: "revoked" } };
		expect(RunSkillsReadResultSchema.parse(blocked)).toEqual(blocked);
		for (const invalid of [
			{ ...detail, runId: id(9) },
			{ ...detail, snapshots: [] },
			{ ...detail, snapshots: [snapshot, snapshot] },
			{
				...detail,
				snapshots: [{ ...snapshot, owner: { ...owner, contextId: id(9) } }],
			},
			{
				...detail,
				snapshots: [
					{ ...snapshot, owner: { ...owner, taskId: id(8), attemptId: id(9) } },
				],
			},
			{ ...detail, block: { code: "revoked", message: "private content" } },
		])
			expect(RunSkillsReadResultSchema.safeParse(invalid).success).toBe(false);
	});

	it("binds every metadata field to its retained snapshot without claiming provider use", () => {
		const loaded = skillLoadedMetadata(snapshot);
		for (const changed of [
			{ ...loaded, receiptId: id(8) },
			{ ...loaded, version: { ...loaded.version, sha256: "d".repeat(64) } },
			{ ...loaded, version: { ...loaded.version, revision: 2 } },
			{ ...loaded, source: { ...loaded.source, scope: "global" } },
			{ ...loaded, source: { ...loaded.source, path: "other/SKILL.md" } },
			{ ...loaded, name: "other" },
			{ ...loaded, origin: "model" },
			{ ...loaded, loadedAt: "2026-11-09T00:00:01Z" },
			{ ...loaded, payloadSha256: "d".repeat(64) },
		])
			expect(
				RunSkillsReadResultSchema.safeParse({
					...detail,
					context: { ...context, loaded: [changed] },
				}).success,
			).toBe(false);
		expect("text" in loaded).toBe(false);
		expect("description" in loaded).toBe(false);
		expect(
			RunSkillsReadResultSchema.safeParse({ ...detail, usedSuccessfully: true })
				.success,
		).toBe(false);
	});

	it("does not cap an entire run at four retained contexts", () => {
		const contexts = Array.from({ length: 5 }, (_, i) => ({
			...context,
			owner: { runId, contextId: id(10 + i) },
			status: "selected",
			loaded: [],
		}));
		const summary = {
			kind: "summary",
			runId,
			policy: {
				mode: "manual",
				roles: [{ roleId: "assistant", selected: policy.selected }],
			},
			contexts,
		};
		expect(RunSkillsReadResultSchema.parse(summary)).toEqual(summary);
	});
});
