import { describe, expect, it } from "vitest";
import {
	SKILL_LIMITS,
	SkillCatalogEntrySchema,
	SkillCatalogListSchema,
	SkillDiagnosticSchema,
	SkillErrorSchema,
	SkillInspectionSchema,
	SkillMetadataSchema,
	SkillSourceDescriptorSchema,
	SkillSourceInputSchema,
	SkillSourceListSchema,
	SkillSourceSnapshotSchema,
	TOOL_CATALOG,
} from "../../src/index.js";

const source = {
	sourceId: "a".repeat(64),
	scope: "workspace",
	path: "review/SKILL.md",
};
const metadata = { name: "review", description: "Review code" };
const snapshot = {
	source,
	text: "\ufeff---\r\nname: review\r\n---\r\nBody",
	sha256: "b".repeat(64),
};
const entry = { source, metadata };
const diagnostic = {
	code: "bad_input",
	sourceId: source.sourceId,
	location: "frontmatter",
};
const candidates = Array.from(
	{ length: SKILL_LIMITS.sourceCandidates },
	(_, i) => ({
		...source,
		sourceId: i.toString(16).padStart(64, "0"),
	}),
);

describe("skill.source@1 and skill.catalog@1 boundaries", () => {
	it("accepts only opaque source lookup, not caller roots or trust claims", () => {
		expect(SkillSourceInputSchema.parse({ sourceId: source.sourceId })).toEqual(
			{ sourceId: source.sourceId },
		);
		for (const bad of [
			{ sourceId: "a".repeat(63) },
			{ sourceId: "A".repeat(64) },
			{ sourceId: source.sourceId, root: "/tmp" },
			{ sourceId: source.sourceId, trusted: true },
		])
			expect(SkillSourceInputSchema.safeParse(bad).success).toBe(false);
		expect(
			SkillSourceDescriptorSchema.parse({ ...source, scope: "global" }).scope,
		).toBe("global");
		for (const path of [
			"/review/SKILL.md",
			"../SKILL.md",
			"./SKILL.md",
			"x/y/SKILL.md",
			"x\\SKILL.md",
			"x/SKILL.md:stream",
			"x/skill.md",
			"x./SKILL.md",
			"con/SKILL.md",
			"x\0/SKILL.md",
			"x\t/SKILL.md",
			"x\n/SKILL.md",
			"\ud800/SKILL.md",
		])
			expect(
				SkillSourceDescriptorSchema.safeParse({ ...source, path }).success,
			).toBe(false);
		expect(
			SkillSourceDescriptorSchema.safeParse({ ...source, scope: "remote" })
				.success,
		).toBe(false);
		expect(
			SkillSourceDescriptorSchema.safeParse({ ...source, root: "/tmp" })
				.success,
		).toBe(false);
	});

	it("preserves BOM and newline bytes, rejecting invalid Unicode, NUL and oversized text", () => {
		expect(SkillSourceSnapshotSchema.parse(snapshot)).toEqual(snapshot);
		for (const text of ["a".repeat(65536), "\u00e9".repeat(32768)])
			expect(SkillSourceSnapshotSchema.parse({ ...snapshot, text }).text).toBe(
				text,
			);
		for (const text of [
			"a".repeat(65537),
			"\u00e9".repeat(32769),
			"\ud800",
			"a\0b",
		])
			expect(
				SkillSourceSnapshotSchema.safeParse({ ...snapshot, text }).success,
			).toBe(false);
		for (const sha256 of ["x", "A".repeat(64), "g".repeat(64)])
			expect(
				SkillSourceSnapshotSchema.safeParse({ ...snapshot, sha256 }).success,
			).toBe(false);
		expect(
			SkillSourceSnapshotSchema.safeParse({ ...snapshot, approved: true })
				.success,
		).toBe(false);
	});

	it("validates standard metadata without granting allowed-tools or matching folder names", () => {
		const full = {
			...metadata,
			license: "MIT",
			compatibility: "Informational",
			metadata: { owner: "local" },
			"allowed-tools": "fs.read",
		};
		expect(SkillMetadataSchema.parse(full)).toEqual(full);
		expect(
			SkillMetadataSchema.parse({ ...metadata, name: "other-name" }).name,
		).toBe("other-name");
		for (const name of [
			"",
			"Upper",
			"-a",
			"a-",
			"a--b",
			"a_b",
			"con",
			"prn",
			"aux",
			"nul",
			"com1",
			"lpt9",
			"a".repeat(65),
		])
			expect(SkillMetadataSchema.safeParse({ ...metadata, name }).success).toBe(
				false,
			);
		for (const bad of [
			{ ...metadata, description: " \n" },
			{ ...metadata, description: "a".repeat(1025) },
			{ ...metadata, license: "a".repeat(501) },
			{ ...metadata, compatibility: "a".repeat(501) },
			{ ...metadata, metadata: { x: 1 } },
			{ ...metadata, metadata: { x: "a".repeat(1025) } },
			{
				...metadata,
				metadata: Object.fromEntries(
					Array.from({ length: 33 }, (_, i) => [String(i), "x"]),
				),
			},
			{ ...metadata, "allowed-tools": ["fs.read"] },
			{ ...metadata, hooks: "execute" },
		])
			expect(SkillMetadataSchema.safeParse(bad).success).toBe(false);
		expect(
			SkillMetadataSchema.safeParse({
				...metadata,
				name: "a".repeat(64),
				description: "a".repeat(1024),
				license: "a".repeat(500),
				compatibility: "a".repeat(500),
				metadata: Object.fromEntries(
					Array.from({ length: 32 }, (_, i) => [String(i), "a".repeat(1024)]),
				),
			}).success,
		).toBe(true);
	});

	it("limits inventories, rejects duplicates and cannot label a limited scan complete", () => {
		const inventory = {
			sources: candidates,
			complete: true,
			diagnostics: [diagnostic],
		};
		expect(SkillSourceListSchema.parse(inventory).sources).toHaveLength(512);
		expect(
			SkillSourceListSchema.safeParse({
				...inventory,
				sources: [...candidates, source],
			}).success,
		).toBe(false);
		expect(
			SkillSourceListSchema.safeParse({
				...inventory,
				sources: [source, source],
			}).success,
		).toBe(false);
		const entries = candidates
			.slice(0, 128)
			.map((source) => ({ source, metadata }));
		expect(
			SkillCatalogListSchema.parse({ entries, complete: true, diagnostics: [] })
				.entries,
		).toHaveLength(128);
		const global = {
			...entry,
			source: { ...source, scope: "global", sourceId: "c".repeat(64) },
		};
		expect(
			SkillCatalogListSchema.parse({
				entries: [entry, global],
				complete: true,
				diagnostics: [],
			}).entries,
		).toHaveLength(2);
		expect(
			SkillCatalogListSchema.safeParse({
				entries: [...entries, entry],
				complete: true,
				diagnostics: [],
			}).success,
		).toBe(false);
		expect(
			SkillCatalogListSchema.safeParse({
				entries: [entry, entry],
				complete: true,
				diagnostics: [],
			}).success,
		).toBe(false);
		const limited = {
			sources: [],
			complete: false,
			diagnostics: [{ code: "limit_exceeded", location: "root" }],
		};
		expect(SkillSourceListSchema.parse(limited).complete).toBe(false);
		expect(
			SkillSourceListSchema.safeParse({ ...limited, complete: true }).success,
		).toBe(false);
		expect(
			SkillCatalogListSchema.safeParse({
				entries: [],
				complete: true,
				diagnostics: limited.diagnostics,
			}).success,
		).toBe(false);
		expect(
			SkillSourceListSchema.safeParse({ sources: [], diagnostics: [] }).success,
		).toBe(false);
	});

	it("keeps safe diagnostics and validated inspections strict, with no model tool", () => {
		for (const code of [
			"bad_input",
			"not_found",
			"ignored",
			"unavailable",
			"limit_exceeded",
			"stale",
			"expired",
			"aborted",
			"busy",
			"storage_failed",
		])
			expect(SkillErrorSchema.parse({ code }).code).toBe(code);
		expect(SkillDiagnosticSchema.parse(diagnostic)).toEqual(diagnostic);
		for (const bad of [
			{ ...diagnostic, message: "secret" },
			{ ...diagnostic, path: "/secret" },
			{ ...diagnostic, location: "/secret" },
			{ ...diagnostic, code: "approved" },
		])
			expect(SkillDiagnosticSchema.safeParse(bad).success).toBe(false);
		expect(SkillCatalogEntrySchema.parse(entry)).toEqual(entry);
		expect(SkillInspectionSchema.parse({ ...snapshot, metadata })).toEqual({
			...snapshot,
			metadata,
		});
		expect(
			SkillInspectionSchema.safeParse({
				...snapshot,
				metadata: { ...metadata, hooks: true },
			}).success,
		).toBe(false);
		expect(
			SkillCatalogEntrySchema.safeParse({ ...entry, state: "approved" })
				.success,
		).toBe(false);
		expect(JSON.stringify(TOOL_CATALOG)).not.toContain("skill.source@1");
		expect(JSON.stringify(TOOL_CATALOG)).not.toContain("skill.catalog@1");
	});
});
