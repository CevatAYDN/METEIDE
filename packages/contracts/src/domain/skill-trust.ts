import { z } from "zod";
import { IdSchema, TimestampSchema } from "./ids.js";
import type { Result } from "./result.js";
import { SkillInspectionSchema, SkillMetadataSchema } from "./skill-catalog.js";
import {
	SkillDiagnosticSchema,
	type SkillError,
	SkillErrorSchema,
	SkillSourceDescriptorSchema,
	SkillSourceIdSchema,
	type SkillSourceInput,
	SkillSourceInputSchema,
} from "./skill-source.js";

const revision = z.number().int().nonnegative();

/** Management state only; approved never means selected or loaded (ADR-189). */
export const SkillTrustStatusSchema = z.enum([
	"unapproved",
	"approved",
	"changed",
	"disabled",
	"missing",
	"invalid",
	"unavailable",
]);
/** Current source evidence plus historical grant identity, including missing files. */
export const SkillTrustEntrySchema = z
	.strictObject({
		source: SkillSourceDescriptorSchema,
		metadata: SkillMetadataSchema.optional(),
		status: SkillTrustStatusSchema,
		revision,
		approvedSha256: SkillSourceIdSchema.optional(),
		currentSha256: SkillSourceIdSchema.optional(),
		diagnostics: z.array(SkillDiagnosticSchema),
	})
	.refine(
		({ revision, approvedSha256 }) =>
			revision > 0 || approvedSha256 === undefined,
	)
	.refine(
		({ status, revision }) =>
			!["approved", "changed", "disabled"].includes(status) || revision > 0,
	)
	.refine(
		({ status, metadata, approvedSha256, currentSha256, diagnostics }) =>
			status !== "approved" ||
			(metadata !== undefined &&
				approvedSha256 !== undefined &&
				currentSha256 === approvedSha256 &&
				diagnostics.length === 0),
	)
	.refine(
		({ status, metadata, approvedSha256, currentSha256 }) =>
			status !== "changed" ||
			(metadata !== undefined &&
				approvedSha256 !== undefined &&
				currentSha256 !== undefined &&
				currentSha256 !== approvedSha256),
	)
	.refine(
		({ status, currentSha256 }) =>
			!["missing", "unavailable"].includes(status) ||
			currentSha256 === undefined,
	);
/** Historical records are not capped by the valid-metadata discovery budget. */
export const SkillTrustListSchema = z
	.strictObject({
		entries: z.array(SkillTrustEntrySchema),
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
/** Masked inspection retains raw-file sha256; it is not the masked text's hash. */
export const SkillPreviewSchema = z.strictObject({
	previewId: IdSchema,
	inspection: SkillInspectionSchema,
	expiresAt: TimestampSchema,
	revision,
});
/** Approval consumes a process-local preview, never caller-supplied content. */
export const SkillApproveInputSchema = z.strictObject({ previewId: IdSchema });
/** Disable compares the acknowledged source revision before recording a tombstone. */
export const SkillDisableInputSchema = z.strictObject({
	...SkillSourceInputSchema.shape,
	expectedRevision: revision,
});
/** Adapter-owned admission survives later errors; unadmitted success is impossible. */
export const SkillMutationResultSchema = z
	.strictObject({
		admitted: z.boolean(),
		result: z.discriminatedUnion("ok", [
			z.strictObject({ ok: z.literal(true), value: SkillTrustEntrySchema }),
			z.strictObject({ ok: z.literal(false), error: SkillErrorSchema }),
		]),
	})
	.refine(({ admitted, result }) => admitted || !result.ok);

/** An exact-version management state. */
export type SkillTrustStatus = z.infer<typeof SkillTrustStatusSchema>;
/** Source evidence and recorded trust revision. */
export type SkillTrustEntry = z.infer<typeof SkillTrustEntrySchema>;
/** Current inventory plus historical source records. */
export type SkillTrustList = z.infer<typeof SkillTrustListSchema>;
/** Reviewable process-local masked preview. */
export type SkillPreview = z.infer<typeof SkillPreviewSchema>;
/** Exact preview-consumption input. */
export type SkillApproveInput = z.infer<typeof SkillApproveInputSchema>;
/** Revision-bound disable input. */
export type SkillDisableInput = z.infer<typeof SkillDisableInputSchema>;
/** Mutation outcome carrying authoritative composition-guard admission. */
export type SkillMutationResult = z.infer<typeof SkillMutationResultSchema>;

/** skill.trust@1; native composition owns admission, never a client idle claim. */
export interface SkillTrustAdapter {
	status(signal: AbortSignal): Promise<Result<SkillTrustList, SkillError>>;
	prepare(
		input: SkillSourceInput,
		signal: AbortSignal,
	): Promise<Result<SkillPreview, SkillError>>;
	approve(
		input: SkillApproveInput,
		signal: AbortSignal,
	): Promise<SkillMutationResult>;
	disable(
		input: SkillDisableInput,
		signal: AbortSignal,
	): Promise<SkillMutationResult>;
}
