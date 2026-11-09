import { z } from "zod";
import type { EngineError } from "./engine.js";
import { IdSchema } from "./ids.js";
import type { Result } from "./result.js";
import {
	RunSkillPolicySchema,
	type RunSkillsStartInput,
} from "./run-skills-input.js";
import {
	SkillContextSnapshotsSchema,
	type SkillOwner,
	type SkillSnapshot,
	type SkillVersion,
} from "./skill-runtime.js";
import {
	type SkillRuntimeError,
	SkillRuntimeErrorSchema,
} from "./skill-runtime-catalog.js";
import {
	SkillContextSummarySchema,
	type SkillLoadedMetadata,
} from "./skill-usage.js";

/** Metadata-only projection; authenticated core reads validate the source snapshot first. */
export const skillLoadedMetadata = (
	snapshot: SkillSnapshot,
): SkillLoadedMetadata => ({
	receiptId: snapshot.receiptId,
	version: {
		sourceId: snapshot.inspection.source.sourceId,
		sha256: snapshot.inspection.sha256,
		revision: snapshot.revision,
	},
	source: snapshot.inspection.source,
	name: snapshot.inspection.metadata.name,
	origin: snapshot.origin,
	loadedAt: snapshot.loadedAt,
	payloadSha256: snapshot.payloadSha256,
});

const sameVersion = (a: SkillVersion, b: SkillVersion | undefined) =>
	a.sourceId === b?.sourceId &&
	a.sha256 === b?.sha256 &&
	a.revision === b?.revision;
const sameOwner = (a: SkillOwner, b: SkillOwner) =>
	a.runId === b.runId &&
	a.contextId === b.contextId &&
	a.taskId === b.taskId &&
	a.attemptId === b.attemptId;
const matches = (
	snapshot: SkillSnapshot,
	metadata: SkillLoadedMetadata | undefined,
) => {
	if (!metadata) return false;
	const actual = skillLoadedMetadata(snapshot);
	return (
		actual.receiptId === metadata.receiptId &&
		sameVersion(actual.version, metadata.version) &&
		actual.source.scope === metadata.source.scope &&
		actual.source.path === metadata.source.path &&
		actual.name === metadata.name &&
		actual.origin === metadata.origin &&
		actual.loadedAt === metadata.loadedAt &&
		actual.payloadSha256 === metadata.payloadSha256
	);
};

/** Read metadata by default; only an exact context request can return retained bodies. */
export const RunSkillsReadInputSchema = z.strictObject({
	runId: IdSchema,
	contextId: IdSchema.optional(),
});
const summary = z
	.strictObject({
		kind: z.literal("summary"),
		runId: IdSchema,
		policy: RunSkillPolicySchema,
		contexts: z.array(SkillContextSummarySchema),
		block: SkillRuntimeErrorSchema.optional(),
	})
	.refine(
		({ runId, contexts }) =>
			contexts.every(({ owner }) => owner.runId === runId) &&
			new Set(contexts.map(({ owner }) => owner.contextId)).size ===
				contexts.length,
	)
	.refine(({ contexts }) => {
		const ids = contexts.flatMap(({ loaded }) =>
			loaded.map(({ receiptId }) => receiptId),
		);
		return new Set(ids).size === ids.length;
	})
	.refine(({ policy, contexts }) =>
		contexts.every((context) => {
			const selected =
				policy.roles.find(({ roleId }) => roleId === context.roleId)
					?.selected ?? [];
			return (
				context.policy.mode === policy.mode &&
				context.policy.selected.length === selected.length &&
				context.policy.selected.every((version, index) =>
					sameVersion(version, selected[index]),
				)
			);
		}),
	);
const detail = z
	.strictObject({
		kind: z.literal("context"),
		runId: IdSchema,
		context: SkillContextSummarySchema,
		snapshots: SkillContextSnapshotsSchema,
		block: SkillRuntimeErrorSchema.optional(),
	})
	.refine(
		({ runId, context, snapshots }) =>
			context.owner.runId === runId &&
			snapshots.length === context.loaded.length &&
			snapshots.every(
				(snapshot, index) =>
					sameOwner(snapshot.owner, context.owner) &&
					matches(snapshot, context.loaded[index]),
			),
	);

/** Distinct legacy, metadata and bounded full-context results; failures are not empty evidence. */
export const RunSkillsReadResultSchema = z.discriminatedUnion("kind", [
	z.strictObject({ kind: z.literal("legacy"), runId: IdSchema }),
	summary,
	detail,
]);
/** Exact run/context read input. */
export type RunSkillsReadInput = z.infer<typeof RunSkillsReadInputSchema>;
/** Authenticated metadata or exact retained context returned by native core. */
export type RunSkillsReadResult = z.infer<typeof RunSkillsReadResultSchema>;

/** run.skills@1: skill-aware native starts and authoritative retained evidence. */
export interface RunSkillsAdapter {
	start(
		input: RunSkillsStartInput,
	): Promise<Result<{ runId: string }, EngineError>>;
	read(
		input: RunSkillsReadInput,
	): Promise<Result<RunSkillsReadResult, SkillRuntimeError>>;
}
