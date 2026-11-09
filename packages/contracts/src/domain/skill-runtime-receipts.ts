import { z } from "zod";
import { SKILL_RUNTIME_LIMITS } from "../defaults.js";
import { IdSchema, TimestampSchema } from "./ids.js";
import {
	type SkillOwner,
	SkillOwnerSchema,
	SkillSnapshotSchema,
	SkillVersionSchema,
} from "./skill-runtime.js";
import { SkillSourceIdSchema } from "./skill-source.js";

/** Exact load intent; parsing never supplies native admission or workspace authority. */
export const SkillRuntimeLoadInputSchema = z.strictObject({
	owner: SkillOwnerSchema,
	operationId: IdSchema,
	version: SkillVersionSchema,
	origin: SkillSnapshotSchema.shape.origin,
});
/** Content-free receipt identity; canonical workspace binding stays private storage. */
export const SkillReceiptSchema = SkillRuntimeLoadInputSchema.extend({
	receiptId: IdSchema,
	loadedAt: TimestampSchema,
	payloadSha256: SkillSourceIdSchema,
});

function validContexts(receipts: readonly SkillReceipt[]): boolean {
	const contexts = new Map<
		string,
		{ owner: SkillOwner; sources: Set<string> }
	>();
	for (const { owner, version } of receipts) {
		const previous = contexts.get(owner.contextId);
		if (
			previous &&
			(owner.runId !== previous.owner.runId ||
				owner.taskId !== previous.owner.taskId ||
				owner.attemptId !== previous.owner.attemptId ||
				previous.sources.has(version.sourceId))
		)
			return false;
		const sources = previous?.sources ?? new Set<string>();
		sources.add(version.sourceId);
		if (sources.size > SKILL_RUNTIME_LIMITS.perContext) return false;
		contexts.set(owner.contextId, { owner, sources });
	}
	return true;
}

/** Complete successful membership across contexts; valid empty data alone proves nothing. */
export const SkillRuntimeInventorySchema = z
	.strictObject({
		runId: IdSchema,
		receipts: z.array(SkillReceiptSchema),
	})
	.refine(({ runId, receipts }) =>
		receipts.every(({ owner }) => owner.runId === runId),
	)
	.refine(
		({ receipts }) =>
			new Set(receipts.map(({ receiptId }) => receiptId)).size ===
			receipts.length,
	)
	.refine(
		({ receipts }) =>
			new Set(receipts.map(({ operationId }) => operationId)).size ===
			receipts.length,
	)
	.refine(({ receipts }) => validContexts(receipts));

/** Exact serialized loading intent, not process-local admission evidence. */
export type SkillRuntimeLoadInput = z.infer<typeof SkillRuntimeLoadInputSchema>;
/** Immutable receipt fields without bodies or native workspace paths. */
export type SkillReceipt = z.infer<typeof SkillReceiptSchema>;
/** Complete run receipt membership, with independent per-context bounds. */
export type SkillRuntimeInventory = z.infer<typeof SkillRuntimeInventorySchema>;
