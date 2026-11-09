import { createHash } from "node:crypto";
import { posix } from "node:path";
import {
	type Result,
	type SkillError,
	SkillErrorSchema,
	type SkillInspection,
	type SkillMetadata,
	SkillMetadataSchema,
	type SkillSourceSnapshot,
	SkillSourceSnapshotSchema,
} from "@mete/contracts";
import { isAlias, parseDocument, visit } from "yaml";
import { SKILL_PARSER_LIMITS } from "../defaults.js";

type Location = NonNullable<SkillError["location"]>;
const failure = (
	location: Location,
	sourceId?: string,
	code: SkillError["code"] = "bad_input",
): Result<never, SkillError> => ({
	ok: false,
	error: { code, location, ...(sourceId ? { sourceId } : {}) },
});

function safeLocation(value: unknown, fallback: Location): Location {
	const parsed = SkillErrorSchema.shape.location.safeParse(value);
	return parsed.success ? (parsed.data ?? fallback) : fallback;
}

function parseSnapshot(
	input: unknown,
): Result<SkillSourceSnapshot, SkillError> {
	const parsed = SkillSourceSnapshotSchema.safeParse(input);
	if (parsed.success) return { ok: true, value: parsed.data };
	const path = parsed.error.issues[0]?.path ?? [];
	if (path.includes("path")) return failure("path");
	if (path[0] === "text") return failure("utf8");
	return failure(safeLocation(path[0], "source"));
}

function parseMetadata(
	frontmatter: string,
	sourceId: string,
): Result<SkillMetadata, SkillError> {
	const doc = parseDocument(frontmatter, {
		uniqueKeys: true,
		strict: true,
		logLevel: "silent",
	});
	if (doc.errors.length || doc.warnings.length) {
		return failure("frontmatter", sourceId);
	}
	let hasReference = false;
	visit(doc, {
		Node: (_key, node) => {
			if (isAlias(node) || node.anchor !== undefined) hasReference = true;
		},
	});
	if (hasReference) return failure("frontmatter", sourceId);
	const value: unknown = doc.toJS({ maxAliasCount: 0 });
	const parsed = SkillMetadataSchema.safeParse(value);
	if (parsed.success) return { ok: true, value: parsed.data };
	const issue = parsed.error.issues[0];
	return failure(
		safeLocation(issue?.path[0], "frontmatter"),
		sourceId,
		issue?.code === "too_big" ? "limit_exceeded" : "bad_input",
	);
}

/** Inspect exact source bytes; metadata is informational, never an authorization. */
export function parseSkill(
	input: unknown,
): Result<SkillInspection, SkillError> {
	try {
		const parsed = parseSnapshot(input);
		if (!parsed.ok) return parsed;
		const snapshot = parsed.value;
		const { source, text, sha256 } = snapshot;
		if (createHash("sha256").update(text, "utf8").digest("hex") !== sha256) {
			return failure("sha256", source.sourceId);
		}
		const parts = /^---\r?\n([\s\S]*?)^---(?:\r?\n|$)([\s\S]*)$/mu.exec(
			text.replace(/^\uFEFF/u, ""),
		);
		if (parts?.index !== 0 || parts[1] === undefined) {
			return failure("frontmatter", source.sourceId);
		}
		if (
			Buffer.byteLength(parts[1], "utf8") > SKILL_PARSER_LIMITS.frontmatterBytes
		) {
			return failure("frontmatter", source.sourceId, "limit_exceeded");
		}
		const metadata = parseMetadata(parts[1], source.sourceId);
		if (!metadata.ok) return metadata;
		if (metadata.value.name !== posix.basename(posix.dirname(source.path))) {
			return failure("name", source.sourceId);
		}
		if (!parts[2]?.trim()) return failure("body", source.sourceId);
		return { ok: true, value: { ...snapshot, metadata: metadata.value } };
	} catch {
		return failure("frontmatter");
	}
}
