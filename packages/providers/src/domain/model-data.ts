import { type ModelInfo, PrivacySchema } from "@mete/contracts";
import { z } from "zod";

// models.yaml from docs/09 (Provider adapter): facts per provider and exact model id.

const known = z.union([z.boolean(), z.literal("unknown")]);

/** One model's facts; `source` and `checked` say where they came from and when. */
export const ModelRowSchema = z.strictObject({
	capability: z.enum(["chat", "embed", "rerank"]),
	contextWindow: z.number().int().nonnegative(),
	toolCalling: known,
	vision: known,
	free: z.boolean(),
	family: z.string().min(1),
	privacy: PrivacySchema.optional(),
	source: z.string().min(1).optional(),
	checked: z.iso.date().optional(),
});

/** A model row. */
export type ModelRow = z.infer<typeof ModelRowSchema>;

/** Rows keyed by provider id, then exact model id. */
export const ModelDataSchema = z
	.record(z.string().min(1), z.record(z.string().min(1), ModelRowSchema))
	.default(() => ({}));

/** All model rows. */
export type ModelData = z.infer<typeof ModelDataSchema>;

/** The user's rows replace shipped rows with the same id and add the others. */
export const mergeModelData = (
	shipped: ModelData,
	user: ModelData,
): ModelData => {
	const providers = new Set([...Object.keys(shipped), ...Object.keys(user)]);
	return Object.fromEntries(
		[...providers].map((p) => [p, { ...shipped[p], ...user[p] }]),
	);
};

/**
 * The chat models a provider lists, with their facts: a listed id without a row gets
 * no context window and is not free, so it fits no tier; a row the provider no
 * longer lists is left out.
 */
export const chatModels = (
	providerId: string,
	listed: readonly string[],
	rows: Readonly<Record<string, ModelRow>>,
): ModelInfo[] =>
	listed.flatMap((id): ModelInfo[] => {
		const row = Object.hasOwn(rows, id) ? rows[id] : undefined;
		if (row && row.capability !== "chat") return [];
		return [
			{
				id,
				providerId,
				family: row?.family ?? "",
				contextWindow: row?.contextWindow ?? 0,
				toolCalling: row?.toolCalling ?? "unknown",
				vision: row?.vision ?? "unknown",
				free: row?.free ?? false,
				deprecated: false,
			},
		];
	});
