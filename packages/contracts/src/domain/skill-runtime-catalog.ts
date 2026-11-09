import { z } from "zod";
import { SKILL_LIMITS, SKILL_RUNTIME_LIMITS } from "../defaults.js";
import { SkillMetadataSchema } from "./skill-catalog.js";
import { SkillVersionSchema } from "./skill-runtime.js";
import {
	SkillErrorSchema,
	SkillSourceDescriptorSchema,
} from "./skill-source.js";

const encoder = new TextEncoder();

/** Safe S2 failures extend S1 vocabulary without changing management contracts. */
export const SkillRuntimeErrorSchema = z.strictObject({
	...SkillErrorSchema.shape,
	code: z.enum([
		...SkillErrorSchema.shape.code.options,
		"revoked",
		"integrity_failed",
		"budget_exceeded",
	]),
});
/** Complete masked metadata identifies the exact offered source/version. */
export const SkillRuntimeDescriptorSchema = z
	.strictObject({
		version: SkillVersionSchema,
		source: SkillSourceDescriptorSchema,
		name: SkillMetadataSchema.shape.name,
		description: SkillMetadataSchema.shape.description,
	})
	.refine(({ version, source }) => version.sourceId === source.sourceId);

const ready = z
	.strictObject({
		status: z.literal("ready"),
		entries: z
			.array(SkillRuntimeDescriptorSchema)
			.max(SKILL_LIMITS.catalogEntries),
		diagnostics: z.tuple([]),
	})
	.refine(
		({ entries }) =>
			new Set(entries.map(({ version }) => version.sourceId)).size ===
			entries.length,
	)
	.refine(
		(catalog) =>
			encoder.encode(JSON.stringify(catalog)).byteLength <=
			SKILL_RUNTIME_LIMITS.catalogBytes,
	);

/** Ready is complete and bounded; unavailable carries only safe refusal reasons. */
export const SkillRuntimeCatalogSchema = z.discriminatedUnion("status", [
	ready,
	z.strictObject({
		status: z.literal("unavailable"),
		entries: z.tuple([]),
		diagnostics: z.array(SkillRuntimeErrorSchema).min(1),
	}),
]);

/** Safe runtime failure with optional S1 source and location identity. */
export type SkillRuntimeError = z.infer<typeof SkillRuntimeErrorSchema>;
/** Exact eligible version and complete masked descriptive metadata. */
export type SkillRuntimeDescriptor = z.infer<
	typeof SkillRuntimeDescriptorSchema
>;
/** Complete ready catalog or explicit unavailable diagnostics, never a prefix. */
export type SkillRuntimeCatalog = z.infer<typeof SkillRuntimeCatalogSchema>;
