import { z } from "zod";
import { SKILL_LIMITS } from "../defaults.js";
import type { Result } from "./result.js";
import {
	SkillDiagnosticSchema,
	type SkillError,
	SkillSourceDescriptorSchema,
	type SkillSourceInput,
	SkillSourceSnapshotSchema,
} from "./skill-source.js";
import { unicodeText } from "./skill-text.js";

const text = z.string().refine(unicodeText);
const metadataValue = text.max(SKILL_LIMITS.metadataValueChars);
const metadataRecord = z.record(text, metadataValue);
// Zod records skip __proto__; validate original entries before safe reconstruction.
const metadataPairs = z
	.custom<z.input<typeof metadataRecord>>()
	.superRefine((input, ctx) => {
		const parsed = metadataRecord.safeParse(input);
		if (!parsed.success)
			for (const issue of parsed.error.issues) ctx.addIssue({ ...issue });
	})
	.transform((pairs) => Object.entries(pairs))
	.pipe(
		z
			.array(z.tuple([text, metadataValue]))
			.refine((pairs) => pairs.length <= SKILL_LIMITS.metadataPairs),
	)
	.transform((pairs) => Object.fromEntries(pairs));

/** Standard frontmatter only; folder matching and nonblank body belong to parsing. */
export const SkillMetadataSchema = z.strictObject({
	name: z
		.string()
		.max(SKILL_LIMITS.nameChars)
		.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
		.refine((name) => !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/u.test(name)),
	description: text
		.max(SKILL_LIMITS.descriptionChars)
		.refine((text) => text.trim().length > 0),
	license: text.max(SKILL_LIMITS.optionalTextChars).optional(),
	compatibility: text.max(SKILL_LIMITS.optionalTextChars).optional(),
	metadata: metadataPairs.optional(),
	"allowed-tools": text.optional(), // Informational only; never a grant.
});
/** Metadata remains source-qualified; equal names never imply shadowing. */
export const SkillCatalogEntrySchema = z.strictObject({
	source: SkillSourceDescriptorSchema,
	metadata: SkillMetadataSchema,
});
/** Parsed inventory without bodies, authorization states or implicit completion. */
export const SkillCatalogListSchema = z
	.strictObject({
		entries: z.array(SkillCatalogEntrySchema).max(SKILL_LIMITS.catalogEntries),
		complete: z.boolean(),
		diagnostics: z.array(SkillDiagnosticSchema),
	})
	.refine(
		({ entries }) =>
			new Set(entries.map(({ source }) => source.sourceId)).size ===
			entries.length,
	)
	.refine(
		({ complete, diagnostics }) =>
			!complete || !diagnostics.some(({ code }) => code === "limit_exceeded"),
	);
/** Complete source snapshot with validated frontmatter, never an approval. */
export const SkillInspectionSchema = SkillSourceSnapshotSchema.extend({
	metadata: SkillMetadataSchema,
});
/** Parsed standard metadata. */
export type SkillMetadata = z.infer<typeof SkillMetadataSchema>;
/** One valid metadata entry. */
export type SkillCatalogEntry = z.infer<typeof SkillCatalogEntrySchema>;
/** Bounded catalog and safe diagnostics. */
export type SkillCatalogList = z.infer<typeof SkillCatalogListSchema>;
/** Exact inspected source and metadata. */
export type SkillInspection = z.infer<typeof SkillInspectionSchema>;

/** skill.catalog@1 management only; resolves skill.source@1 via the registry. */
export interface SkillCatalogAdapter {
	list(signal: AbortSignal): Promise<Result<SkillCatalogList, SkillError>>;
	inspect(
		input: SkillSourceInput,
		signal: AbortSignal,
	): Promise<Result<SkillInspection, SkillError>>;
}
