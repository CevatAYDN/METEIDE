import { describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import {
	SkillRuntimeCatalogSchema,
	SkillRuntimeDescriptorSchema,
	SkillRuntimeErrorSchema,
} from "../../src/domain/skill-runtime-catalog.js";
import { SkillErrorSchema } from "../../src/domain/skill-source.js";

const descriptor = (n: number, description = "Review code") => {
	const sourceId = n.toString(16).padStart(64, "0");
	return {
		version: { sourceId, sha256: "b".repeat(64), revision: 1 },
		source: { sourceId, scope: "workspace", path: "review/SKILL.md" },
		name: "review",
		description,
	};
};
const entry = descriptor(1);
const ready = { status: "ready", entries: [entry], diagnostics: [] };
const unavailable = {
	status: "unavailable",
	entries: [],
	diagnostics: [{ code: "unavailable" }],
};
const accepts = (schema: ZodType, input: unknown) =>
	expect(schema.parse(input)).toEqual(input);
const rejects = (schema: ZodType, input: unknown) =>
	expect(schema.safeParse(input).success).toBe(false);

describe("S2 runtime catalog contracts", () => {
	it("extends safe errors without changing the S1 vocabulary", () => {
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
		]) {
			const error = { code, sourceId: entry.source.sourceId, location: "body" };
			accepts(SkillErrorSchema, error);
			accepts(SkillRuntimeErrorSchema, error);
		}
		for (const code of ["revoked", "integrity_failed", "budget_exceeded"]) {
			accepts(SkillRuntimeErrorSchema, { code });
			rejects(SkillErrorSchema, { code });
		}
		for (const bad of [
			{ code: "failed" },
			{ code: "revoked", sourceId: "bad" },
			{ code: "revoked", location: "/private" },
			{ code: "revoked", message: "secret" },
			{ code: "revoked", path: "/private" },
			{ code: "revoked", text: "skill body" },
		])
			rejects(SkillRuntimeErrorSchema, bad);
	});

	it("requires matching strict source/version and validated metadata", () => {
		accepts(SkillRuntimeDescriptorSchema, entry);
		for (const bad of [
			{ ...entry, version: { ...entry.version, sourceId: "c".repeat(64) } },
			{ ...entry, version: { ...entry.version, sha256: "bad" } },
			{ ...entry, version: { ...entry.version, revision: 0 } },
			{ ...entry, version: { ...entry.version, trusted: true } },
			{ ...entry, source: { ...entry.source, root: "/private" } },
			{ ...entry, source: { ...entry.source, path: "../SKILL.md" } },
			{ ...entry, name: "Upper" },
			{ ...entry, description: " \n" },
			{ ...entry, description: "\ud800" },
			{ ...entry, description: "a\0b" },
			{ ...entry, description: "a".repeat(1025) },
			{ ...entry, text: "body" },
			{ ...entry, approved: true },
		])
			rejects(SkillRuntimeDescriptorSchema, bad);
	});

	it("distinguishes ready-empty from unavailable and refuses unknown keys", () => {
		accepts(SkillRuntimeCatalogSchema, { ...ready, entries: [] });
		accepts(SkillRuntimeCatalogSchema, ready);
		accepts(SkillRuntimeCatalogSchema, unavailable);
		for (const bad of [
			{ ...ready, complete: true },
			{ ...unavailable, message: "secret" },
			{ ...ready, status: "partial" },
			{ entries: [], diagnostics: [] },
			{ ...ready, entries: [{ ...entry, body: "instructions" }] },
			{ ...unavailable, diagnostics: [{ code: "revoked", path: "/private" }] },
			{ ...unavailable, diagnostics: [{ code: "revoked", text: "body" }] },
			{ ...unavailable, diagnostics: [{ code: "revoked", message: "secret" }] },
		])
			rejects(SkillRuntimeCatalogSchema, bad);
	});

	it("requires empty ready diagnostics and unavailable entries with a reason", () => {
		for (const bad of [
			{ ...ready, diagnostics: [{ code: "unavailable" }] },
			{ ...unavailable, entries: [entry] },
			{ ...unavailable, diagnostics: [] },
			{ status: "ready", entries: [] },
			{ status: "unavailable", diagnostics: [{ code: "unavailable" }] },
		])
			rejects(SkillRuntimeCatalogSchema, bad);
		accepts(SkillRuntimeCatalogSchema, {
			...unavailable,
			diagnostics: [{ code: "budget_exceeded" }],
		});
	});

	it("keeps same-name sources distinct and refuses repeated source versions", () => {
		const second = descriptor(2);
		const global = {
			...second,
			source: { ...second.source, scope: "global" },
		};
		accepts(SkillRuntimeCatalogSchema, { ...ready, entries: [global, entry] });
		for (const duplicate of [
			entry,
			{ ...entry, version: { ...entry.version, revision: 2 } },
			{ ...entry, version: { ...entry.version, sha256: "c".repeat(64) } },
		])
			rejects(SkillRuntimeCatalogSchema, {
				...ready,
				entries: [entry, duplicate],
			});
	});

	it("enforces the entry count as well as the tighter complete JSON budget", () => {
		const entries = Array.from({ length: 129 }, (_, i) => descriptor(i + 1));
		accepts(SkillRuntimeCatalogSchema, {
			...ready,
			entries: entries.slice(0, 32),
		});
		const result = SkillRuntimeCatalogSchema.safeParse({ ...ready, entries });
		expect(result.success).toBe(false);
		expect(result.error?.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "too_big",
					path: ["entries"],
					maximum: 128,
				}),
			]),
		);
	});

	it("retains full Unicode at 16384 JSON bytes and refuses one extra byte", () => {
		// Fixed payload: 2831 framing/identity bytes + 13553 description bytes.
		const entries = [
			...Array.from({ length: 6 }, (_, i) =>
				descriptor(i + 1, "\u00e9".repeat(1024)),
			),
			descriptor(7, "\u00e9".repeat(632)),
			descriptor(8, "a"),
		];
		const exact = { ...ready, entries };
		expect(new TextEncoder().encode(JSON.stringify(exact)).byteLength).toBe(
			16384,
		);
		accepts(SkillRuntimeCatalogSchema, exact);
		accepts(SkillRuntimeCatalogSchema, {
			...ready,
			entries: [
				...entries.slice(0, 6),
				descriptor(7, `${"\u00e9".repeat(631)}a`),
				descriptor(8, "a"),
			],
		});
		rejects(SkillRuntimeCatalogSchema, {
			...ready,
			entries: [...entries.slice(0, 7), descriptor(8, "aa")],
		});
	});
});
