import {
	hasOrderedSkillLoads,
	IdSchema,
	LocalIdSchema,
	type RunSkillPolicy,
	RunSkillPolicySchema,
	SkillContextSnapshotsSchema,
	type SkillOwner,
	SkillOwnerSchema,
	type SkillPolicy,
	SkillRuntimeCatalogSchema,
	SkillRuntimeErrorSchema,
} from "@mete/contracts";
import { z } from "zod";

const sameOwner = (a: SkillOwner, b: SkillOwner) =>
	a.runId === b.runId &&
	a.contextId === b.contextId &&
	a.taskId === b.taskId &&
	a.attemptId === b.attemptId;

/** One native ordinary conversation's complete retained instruction state. */
export const SkillContextStateSchema = z
	.strictObject({
		owner: SkillOwnerSchema,
		roleId: LocalIdSchema,
		snapshots: SkillContextSnapshotsSchema,
		catalog: SkillRuntimeCatalogSchema.optional(),
		block: SkillRuntimeErrorSchema.optional(),
	})
	.refine(({ owner, snapshots }) =>
		snapshots.every((snapshot) => sameOwner(snapshot.owner, owner)),
	);

/** Derives one role's immutable policy without inheriting another context's loads. */
export const skillPolicyFor = (
	policy: RunSkillPolicy,
	roleId: string,
): SkillPolicy => ({
	mode: policy.mode,
	selected: [
		...(policy.roles.find((role) => role.roleId === roleId)?.selected ?? []),
	],
});

const originsMatch = (
	context: z.infer<typeof SkillContextStateSchema>,
	policy: RunSkillPolicy,
) => {
	return hasOrderedSkillLoads(
		skillPolicyFor(policy, context.roleId),
		context.snapshots.map((snapshot) => ({
			origin: snapshot.origin,
			version: {
				sourceId: snapshot.inspection.source.sourceId,
				sha256: snapshot.inspection.sha256,
				revision: snapshot.revision,
			},
		})),
	);
};

/** Complete run-owned history; neither missing markers nor valid JSON establish authority. */
export const RunSkillStateSchema = z
	.strictObject({
		runId: IdSchema,
		policy: RunSkillPolicySchema,
		contexts: z.array(SkillContextStateSchema),
	})
	.refine(
		({ runId, contexts }) =>
			contexts.every(({ owner }) => owner.runId === runId) &&
			new Set(contexts.map(({ owner }) => owner.contextId)).size ===
				contexts.length,
	)
	.refine(({ contexts }) => {
		const ids = contexts.flatMap(({ snapshots }) =>
			snapshots.map(({ receiptId }) => receiptId),
		);
		return ids.length === new Set(ids).size;
	})
	.refine(({ contexts, policy }) =>
		contexts.every((context) => originsMatch(context, policy)),
	);

/** Durable skill context, separate from ordinary messages and summary input. */
export type SkillContextState = z.infer<typeof SkillContextStateSchema>;
/** Durable complete run skill state, authenticated through the global inventory on use. */
export type RunSkillState = z.infer<typeof RunSkillStateSchema>;
