import { z } from "zod";
import { IdSchema } from "./ids.js";
import type { Result } from "./result.js";
import {
	SkillContextSnapshotsSchema,
	type SkillSnapshot,
	SkillSnapshotSchema,
	type SkillVersion,
	SkillVersionSchema,
} from "./skill-runtime.js";
import {
	type SkillRuntimeCatalog,
	SkillRuntimeCatalogSchema,
	type SkillRuntimeError,
	SkillRuntimeErrorSchema,
} from "./skill-runtime-catalog.js";
import {
	type SkillRuntimeInventory,
	SkillRuntimeInventorySchema,
	type SkillRuntimeLoadInput,
} from "./skill-runtime-receipts.js";
import type { ToolContext } from "./tools.js";

/** Source-independent receipt lookup; canonical workspace binding stays private. */
export const SkillRuntimeInventoryInputSchema = z.strictObject({
	runId: IdSchema,
});
/** Every retained context is checked; the complete run is not capped at four. */
export const SkillRuntimeCheckInputSchema = z
	.strictObject({ runId: IdSchema, snapshots: z.array(SkillSnapshotSchema) })
	.refine(({ runId, snapshots }) =>
		snapshots.every(({ owner }) => owner.runId === runId),
	)
	.refine(
		({ snapshots }) =>
			new Set(snapshots.map(({ receiptId }) => receiptId)).size ===
			snapshots.length,
	)
	.refine(({ snapshots }) => {
		const contexts = new Map<string, SkillSnapshot[]>();
		for (const snapshot of snapshots) {
			const group = contexts.get(snapshot.owner.contextId) ?? [];
			group.push(snapshot);
			contexts.set(snapshot.owner.contextId, group);
		}
		return [...contexts.values()].every(
			(group) => SkillContextSnapshotsSchema.safeParse(group).success,
		);
	});

const resultOf = <T>(schema: z.ZodType<T>) =>
	z.discriminatedUnion("ok", [
		z.strictObject({ ok: z.literal(true), value: schema }),
		z.strictObject({ ok: z.literal(false), error: SkillRuntimeErrorSchema }),
	]);

/** Strict complete inventory result; a failure never becomes an empty list. */
export const SkillRuntimeInventoryResultSchema = resultOf(
	SkillRuntimeInventorySchema,
);
/** Strict catalog result, including explicit ready-empty versus unavailable. */
export const SkillRuntimeCatalogResultSchema = resultOf(
	SkillRuntimeCatalogSchema,
);
/** Success is the full receipt-bound masked snapshot, for native core only. */
export const SkillRuntimeLoadResultSchema = resultOf(SkillSnapshotSchema);
/** Successful checking has no replacement payload or renewed authority. */
export const SkillRuntimeCheckResultSchema = resultOf(z.undefined());
/** Model-visible acknowledgement excludes bodies, descriptions and owner claims. */
export const SkillLoadOutputSchema = z.strictObject({
	receiptId: IdSchema,
	version: SkillVersionSchema,
	origin: SkillSnapshotSchema.shape.origin,
	loadedAt: SkillSnapshotSchema.shape.loadedAt,
});

/** Complete run receipt lookup input. */
export type SkillRuntimeInventoryInput = z.infer<
	typeof SkillRuntimeInventoryInputSchema
>;
/** All retained run snapshots presented for independent receipt validation. */
export type SkillRuntimeCheckInput = z.infer<
	typeof SkillRuntimeCheckInputSchema
>;
/** Metadata-only model acknowledgement, not evidence of provider use. */
export type SkillLoadOutput = z.infer<typeof SkillLoadOutputSchema>;

/** skill.runtime@1; native private admission is required for every fresh load. */
export interface SkillRuntimeAdapter {
	inventory(
		input: SkillRuntimeInventoryInput,
		signal: AbortSignal,
	): Promise<Result<SkillRuntimeInventory, SkillRuntimeError>>;
	catalog(
		signal: AbortSignal,
	): Promise<Result<SkillRuntimeCatalog, SkillRuntimeError>>;
	load(
		input: SkillRuntimeLoadInput,
		signal: AbortSignal,
	): Promise<Result<SkillSnapshot, SkillRuntimeError>>;
	check(
		input: SkillRuntimeCheckInput,
		signal: AbortSignal,
	): Promise<Result<void, SkillRuntimeError>>;
}

/** skill.load@1; core authenticates the exact pending ToolContext, never its fields alone. */
export interface SkillLoadAdapter {
	run(
		input: SkillVersion,
		ctx: ToolContext,
	): Promise<Result<SkillLoadOutput, SkillRuntimeError>>;
}
