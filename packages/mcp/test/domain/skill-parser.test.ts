import { createHash } from "node:crypto";
import { posix } from "node:path";
import {
	SKILL_LIMITS,
	SkillErrorSchema,
	SkillInspectionSchema,
} from "@mete/contracts";
import { describe, expect, it } from "vitest";
import { SKILL_PARSER_LIMITS } from "../../src/defaults.js";
import { parseSkill } from "../../src/domain/skill-parser.js";

const digest = (text: string) =>
	createHash("sha256").update(text, "utf8").digest("hex");
const sourceId = digest("parser fixture source");
const metadata = { name: "example", description: "Review local changes" };
const header = "name: example\ndescription: Review local changes\n";
const document = (fields = header, body = "# Instructions\nReview the diff.") =>
	`---\n${fields}---\n${body}`;
const snapshot = (text: string, folder = "example") => ({
	source: {
		sourceId,
		scope: "workspace",
		path: posix.join(folder, "SKILL.md"),
	},
	text,
	sha256: digest(text),
});
const refused = (input: unknown, location: string, code = "bad_input") => {
	const result = parseSkill(input);
	expect(result).toMatchObject({ ok: false, error: { code, location } });
	if (!result.ok) {
		expect(SkillErrorSchema.safeParse(result.error).success).toBe(true);
	}
	return result;
};

describe("strict skill parsing", () => {
	it.each(["\n", "\r\n"])("preserves full text and BOM with %j", (newline) => {
		for (const bom of ["", "\uFEFF"]) {
			const text = bom + document().replaceAll("\n", newline);
			const input = snapshot(text);
			const result = parseSkill(input);
			expect(result).toEqual({
				ok: true,
				value: { ...input, metadata },
			});
			if (result.ok) {
				expect(SkillInspectionSchema.safeParse(result.value).success).toBe(
					true,
				);
			}
		}
	});

	it("rejects forged or normalized digests, including stripped BOM", () => {
		const text = `\uFEFF${document().replaceAll("\n", "\r\n")}`;
		const hashes = [
			digest("other bytes"),
			digest(text.slice(1)),
			digest(document()),
		];
		for (const sha256 of hashes) {
			refused({ ...snapshot(text), sha256 }, "sha256");
		}
	});

	it("validates malformed adapter snapshots without reflecting input", () => {
		const invalid = [
			null,
			{},
			{ ...snapshot(document()), extra: "private value" },
		];
		for (const input of invalid) {
			const result = parseSkill(input);
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(SkillErrorSchema.safeParse(result.error).success).toBe(true);
			}
		}
		refused(snapshot(`${document()}\0`), "utf8");
		refused(snapshot(`${document()}\uD800`), "utf8");
	});

	it.each([
		"missing opening",
		`prefix\n${document()}`,
		` ---\n${header}---\nBody`,
		`---\n${header}Body`,
		`---\n${header}--- trailing\nBody`,
		document("name: [\ndescription: text\n"),
		document(`${header}name: example\n`),
		document(`${header}metadata: {key: first, key: second}\n`),
		document("name: &unused example\ndescription: text\n"),
		document("name: example\ndescription: *undefined\n"),
		document("name: &label example\ndescription: *label\n"),
		document(`${header}metadata: &unused {key: value}\n`),
		document(`${header}metadata: {key: &unused value}\n`),
	])(
		"refuses malformed delimiters, YAML, duplicates and aliases: %j",
		(text) => {
			refused(snapshot(text), "frontmatter");
		},
	);

	it.each(["vendor-private", "model", "scripts", "permissions"])(
		"refuses unsupported %s without disclosing key or value",
		(field) => {
			const result = refused(
				snapshot(document(`${header}${field}: private marker\n`)),
				"frontmatter",
			);
			expect(JSON.stringify(result)).not.toContain(field);
			expect(JSON.stringify(result)).not.toContain("private marker");
		},
	);

	it("keeps supported optional metadata informational", () => {
		const text = document(`${header}license: MIT
compatibility: local review only
metadata: {author: fixture}
allowed-tools: fs.read shell.exec
`);
		const result = parseSkill(snapshot(text));
		expect(result).toEqual({
			ok: true,
			value: {
				...snapshot(text),
				metadata: {
					...metadata,
					license: "MIT",
					compatibility: "local review only",
					metadata: { author: "fixture" },
					"allowed-tools": "fs.read shell.exec",
				},
			},
		});
	});

	it("matches directory names and refuses Windows devices and blank bodies", () => {
		refused(snapshot(document(), "other"), "name");
		for (const name of ["con", "prn", "aux", "nul", "com1", "lpt9"]) {
			refused(snapshot(document(`name: ${name}\ndescription: text\n`)), "name");
			refused(snapshot(document(), name), "path");
		}
		for (const body of ["", " \r\n\t"]) {
			refused(snapshot(document(header, body)), "body");
		}
	});

	it.each([
		["name", SKILL_LIMITS.nameChars],
		["description", SKILL_LIMITS.descriptionChars],
		["license", SKILL_LIMITS.optionalTextChars],
		["compatibility", SKILL_LIMITS.optionalTextChars],
	] as const)("enforces %s length at the boundary", (field, limit) => {
		for (const extra of [0, 1]) {
			const value = "a".repeat(limit + extra);
			const fields = `${JSON.stringify({ ...metadata, [field]: value })}\n`;
			const input = snapshot(
				document(fields),
				field === "name" ? value : "example",
			);
			if (extra === 0) expect(parseSkill(input).ok).toBe(true);
			else refused(input, field, "limit_exceeded");
		}
	});

	it("enforces metadata pair/value limits and required field types", () => {
		const cases = [
			[SKILL_LIMITS.metadataPairs, 1, true],
			[SKILL_LIMITS.metadataPairs + 1, 1, false],
			[1, SKILL_LIMITS.metadataValueChars, true],
			[1, SKILL_LIMITS.metadataValueChars + 1, false],
		] as const;
		for (const [count, length, valid] of cases) {
			const pairs = Array.from(
				{ length: count },
				(_, i) => `  key${i}: ${"a".repeat(length)}\n`,
			).join("");
			const result = parseSkill(
				snapshot(document(`${header}metadata:\n${pairs}`)),
			);
			expect(result.ok).toBe(valid);
			if (!result.ok) expect(result.error.location).toBe("metadata");
		}
		for (const fields of [
			"description: text\n",
			"name: example\n",
			"name: Example\ndescription: text\n",
			"name: example\ndescription: ' '\n",
			"name: example\ndescription: 42\n",
			`${header}allowed-tools: [read]\n`,
			`${header}metadata: {key: 42}\n`,
		]) {
			expect(parseSkill(snapshot(document(fields))).ok).toBe(false);
		}
	});

	it("bounds frontmatter UTF-8 bytes without truncating a version", () => {
		const budget = SKILL_PARSER_LIMITS.frontmatterBytes;
		for (const extra of [0, 1]) {
			const padding = budget - Buffer.byteLength(header) - 2 + extra;
			const fields = `${header}#${"x".repeat(padding)}\n`;
			const input = snapshot(document(fields));
			if (extra === 0) expect(parseSkill(input).ok).toBe(true);
			else refused(input, "frontmatter", "limit_exceeded");
		}
		const fields = `${header}#${"\u00E9".repeat(budget / 2)}\n`;
		refused(snapshot(document(fields)), "frontmatter", "limit_exceeded");
	});
});
