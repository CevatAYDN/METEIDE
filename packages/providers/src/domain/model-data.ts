import {
	type ModelInfo,
	ModelInfoSchema,
	type Privacy,
	PrivacySchema,
} from "@mete/contracts";
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
	// A paid model's price, US dollars per million tokens (docs/09, ADR-042).
	price: ModelInfoSchema.shape.price,
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
		const row = rowOf(rows, id);
		if (row && row.capability !== "chat") return [];
		return [withRow(bare(providerId, id), row)];
	});

/** The embedding models a provider lists: only ids an `embed` row names (ADR-152). */
export const embedModels = (
	providerId: string,
	listed: readonly string[],
	rows: Readonly<Record<string, ModelRow>>,
): ModelInfo[] =>
	listed.flatMap((id): ModelInfo[] => {
		const row = rowOf(rows, id);
		return row?.capability === "embed"
			? [withRow(bare(providerId, id), row)]
			: [];
	});

const rowOf = (rows: Readonly<Record<string, ModelRow>>, id: string) =>
	Object.hasOwn(rows, id) ? rows[id] : undefined;

// A listed model with no facts yet: no context window and not free, so it fits no tier.
const bare = (providerId: string, id: string): ModelInfo => ({
	id,
	providerId,
	family: "",
	contextWindow: 0,
	toolCalling: "unknown",
	vision: "unknown",
	free: false,
	deprecated: false,
});

/** A provider's own facts about a model, overridden by a row the user or models.yaml gives. */
export const withRow = (
	info: ModelInfo,
	row: ModelRow | undefined,
): ModelInfo =>
	row
		? {
				...info,
				family: row.family,
				contextWindow: row.contextWindow,
				toolCalling: row.toolCalling,
				vision: row.vision,
				free: row.free,
				...(row.price ? { price: row.price } : {}),
			}
		: info;

const UNKNOWN: Privacy = {
	trains: "unknown",
	logs: "unknown",
	publishes: "unknown",
};

/** A model's privacy from its row; unknown without one (docs/09, provider facts). */
export const privacyFromRows =
	(rows: Readonly<Record<string, ModelRow>>) =>
	(model: ModelInfo): Privacy =>
		(Object.hasOwn(rows, model.id) ? rows[model.id]?.privacy : undefined) ??
		UNKNOWN;
