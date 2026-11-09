import { z } from "zod";
import { SKILL_RUNTIME_LIMITS } from "../defaults.js";
import { IdSchema, TimestampSchema } from "./ids.js";
import { SkillMetadataSchema } from "./skill-catalog.js";
import {
	SkillOwnerSchema,
	type SkillPolicy,
	SkillPolicySchema,
	SkillSnapshotSchema,
	SkillVersionSchema,
} from "./skill-runtime.js";
import { SkillRuntimeErrorSchema } from "./skill-runtime-catalog.js";
import {
	SkillSourceDescriptorSchema,
	SkillSourceIdSchema,
} from "./skill-source.js";
import { LocalIdSchema } from "./template.js";

/** Source-qualified retained metadata, not content, authority or model compliance. */
export const SkillLoadedMetadataSchema = z
	.strictObject({
		receiptId: IdSchema,
		version: SkillVersionSchema,
		source: SkillSourceDescriptorSchema,
		name: SkillMetadataSchema.shape.name,
		origin: SkillSnapshotSchema.shape.origin,
		loadedAt: TimestampSchema,
		payloadSha256: SkillSourceIdSchema,
	})
	.refine(({ version, source }) => version.sourceId === source.sourceId);

/** Explicit selections load as an ordered prefix before any model-selected additions. */
export const hasOrderedSkillLoads = (
	policy: SkillPolicy,
	loaded: readonly Pick<SkillLoadedMetadata, "origin" | "version">[],
): boolean =>
	loaded.every(({ origin, version }, index) => {
		if (origin === "model")
			return policy.mode === "auto" && index >= policy.selected.length;
		const selected = policy.selected[index];
		return (
			policy.mode !== "off" &&
			selected !== undefined &&
			selected.sourceId === version.sourceId &&
			selected.sha256 === version.sha256 &&
			selected.revision === version.revision
		);
	});

/** Catalog availability with safe diagnostics only, never entries or bodies. */
export const SkillCatalogNoticeSchema = z.discriminatedUnion("status", [
	z.strictObject({
		status: z.literal("ready"),
		diagnostics: z.tuple([]),
	}),
	z.strictObject({
		status: z.literal("unavailable"),
		diagnostics: z.array(SkillRuntimeErrorSchema).min(1),
	}),
]);

/** One context's metadata claims; native core must authenticate retained evidence. */
export const SkillContextSummarySchema = z
	.strictObject({
		owner: SkillOwnerSchema,
		roleId: LocalIdSchema,
		policy: SkillPolicySchema,
		status: z.enum(["selected", "loaded", "blocked", "history"]),
		loaded: z
			.array(SkillLoadedMetadataSchema)
			.max(SKILL_RUNTIME_LIMITS.perContext),
		block: SkillRuntimeErrorSchema.optional(),
		catalog: SkillCatalogNoticeSchema.optional(),
	})
	.refine(
		({ loaded }) =>
			new Set(loaded.map(({ version }) => version.sourceId)).size ===
				loaded.length &&
			new Set(loaded.map(({ receiptId }) => receiptId)).size === loaded.length,
	)
	.refine(({ status, loaded, block }) => {
		if (status === "selected")
			return loaded.length === 0 && block === undefined;
		if (status === "loaded") return loaded.length > 0 && block === undefined;
		return status !== "blocked" || block !== undefined;
	})
	.refine(({ policy, loaded }) => hasOrderedSkillLoads(policy, loaded));

/** Exact retained source/version metadata without a body or trust claim. */
export type SkillLoadedMetadata = z.infer<typeof SkillLoadedMetadataSchema>;
/** Metadata-only catalog availability or safe refusal reasons. */
export type SkillCatalogNotice = z.infer<typeof SkillCatalogNoticeSchema>;
/** Context state and immutable policy evidence, including historical records. */
export type SkillContextSummary = z.infer<typeof SkillContextSummarySchema>;
