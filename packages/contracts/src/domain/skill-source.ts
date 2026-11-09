import { z } from "zod";
import { SKILL_LIMITS } from "../defaults.js";
import type { Result } from "./result.js";
import { unicodeText } from "./skill-text.js";

const encoder = new TextEncoder();
const device = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

/** Canonical scope/root (dev/ino)/relative-source identity; excludes content. */
export const SkillSourceIdSchema = z.string().regex(/^[a-f0-9]{64}$/u);
/** Expected S1 failures; diagnostics contain no raw messages or filesystem roots. */
export const SkillErrorSchema = z.strictObject({
	code: z.enum([
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
	]),
	sourceId: SkillSourceIdSchema.optional(),
	location: z
		.enum([
			"root",
			"source",
			"path",
			"utf8",
			"frontmatter",
			"name",
			"description",
			"license",
			"compatibility",
			"metadata",
			"allowed-tools",
			"body",
			"sha256",
		])
		.optional(),
});
/** Safe per-source validation diagnostics use the shared S1 failure vocabulary. */
export const SkillDiagnosticSchema = SkillErrorSchema;
/** A direct child source label; native confinement/identity remain adapter duties. */
export const SkillSourceDescriptorSchema = z.strictObject({
	sourceId: SkillSourceIdSchema,
	scope: z.enum(["workspace", "global"]),
	path: z
		.string()
		.regex(/^[^/\\:<>|"*?]+\/SKILL\.md$/u)
		.refine((value) => [...value].every((char) => char.charCodeAt(0) >= 0x20))
		.refine((value) => {
			const folder = value.slice(0, -"/SKILL.md".length);
			return (
				unicodeText(value) && !/[. ]$/u.test(folder) && !device.test(folder)
			);
		}),
});
/** Both management reads resolve the opaque identifier server-side. */
export const SkillSourceInputSchema = z.strictObject({
	sourceId: SkillSourceIdSchema,
});
/** Exact decoded bytes including BOM; adapters compute the raw-byte SHA-256. */
export const SkillSourceSnapshotSchema = z.strictObject({
	source: SkillSourceDescriptorSchema,
	text: z
		.string()
		.max(SKILL_LIMITS.fileBytes)
		.refine(
			(value) =>
				unicodeText(value) &&
				encoder.encode(value).byteLength <= SKILL_LIMITS.fileBytes,
		),
	sha256: SkillSourceIdSchema,
});
/** Bounded inventory; invalid sources may be diagnosed without becoming entries. */
export const SkillSourceListSchema = z
	.strictObject({
		sources: z
			.array(SkillSourceDescriptorSchema)
			.max(SKILL_LIMITS.sourceCandidates),
		complete: z.boolean(),
		diagnostics: z.array(SkillDiagnosticSchema),
	})
	.refine(
		({ sources }) =>
			new Set(sources.map((source) => source.sourceId)).size === sources.length,
	)
	.refine(
		({ complete, diagnostics }) =>
			!complete || !diagnostics.some(({ code }) => code === "limit_exceeded"),
	);

/** Opaque source lookup input. */
export type SkillSourceInput = z.infer<typeof SkillSourceInputSchema>;
/** Source-qualified label with no exposed native root. */
export type SkillSourceDescriptor = z.infer<typeof SkillSourceDescriptorSchema>;
/** Complete exact source text and implementation-computed digest. */
export type SkillSourceSnapshot = z.infer<typeof SkillSourceSnapshotSchema>;
/** Explicit inventory completeness and safe diagnostics. */
export type SkillSourceList = z.infer<typeof SkillSourceListSchema>;
/** Shared expected failure type. */
export type SkillError = z.infer<typeof SkillErrorSchema>;
/** Safe discovery or parsing failure location. */
export type SkillDiagnostic = z.infer<typeof SkillDiagnosticSchema>;

/** skill.source@1 management only; never a model tool. */
export interface SkillSourceAdapter {
	list(signal: AbortSignal): Promise<Result<SkillSourceList, SkillError>>;
	read(
		input: SkillSourceInput,
		signal: AbortSignal,
	): Promise<Result<SkillSourceSnapshot, SkillError>>;
}
