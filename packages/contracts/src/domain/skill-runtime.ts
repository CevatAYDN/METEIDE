import { z } from "zod";
import { SKILL_RUNTIME_LIMITS } from "../defaults.js";
import { IdSchema, TimestampSchema } from "./ids.js";
import { SkillInspectionSchema } from "./skill-catalog.js";
import { SkillSourceIdSchema } from "./skill-source.js";

const revision = z.number().int().positive();
const encoder = new TextEncoder();

/** Exact S1 source bytes and positive grant revision, never a trust declaration. */
export const SkillVersionSchema = z.strictObject({
	sourceId: SkillSourceIdSchema,
	sha256: SkillSourceIdSchema,
	revision,
});
/** One native run context; ordinary task ownership includes its exact attempt. */
export const SkillOwnerSchema = z
	.strictObject({
		runId: IdSchema,
		contextId: IdSchema,
		taskId: IdSchema.optional(),
		attemptId: IdSchema.optional(),
	})
	.refine(
		({ taskId, attemptId }) =>
			(taskId === undefined) === (attemptId === undefined),
	);
/** Ordered exact selections; off forbids selections and no mode truncates them. */
export const SkillPolicySchema = z
	.strictObject({
		mode: z.enum(["off", "manual", "auto"]).default("auto"),
		selected: z
			.array(SkillVersionSchema)
			.max(SKILL_RUNTIME_LIMITS.perContext)
			.default([]),
	})
	.refine(({ mode, selected }) => mode !== "off" || selected.length === 0)
	.refine(
		({ selected }) =>
			new Set(selected.map(({ sourceId }) => sourceId)).size ===
			selected.length,
	);
/** Complete masked inspection retains raw sha256; payload digest alone grants nothing. */
export const SkillSnapshotSchema = z.strictObject({
	receiptId: IdSchema,
	owner: SkillOwnerSchema,
	inspection: SkillInspectionSchema,
	revision,
	origin: z.enum(["explicit", "model"]),
	loadedAt: TimestampSchema,
	payloadSha256: SkillSourceIdSchema,
});
/** One context's complete snapshots, not a run-wide collection or authorization check. */
export const SkillContextSnapshotsSchema = z
	.array(SkillSnapshotSchema)
	.max(SKILL_RUNTIME_LIMITS.perContext)
	.refine((snapshots) =>
		snapshots.every(
			({ owner }) =>
				owner.runId === snapshots[0]?.owner.runId &&
				owner.contextId === snapshots[0]?.owner.contextId &&
				owner.taskId === snapshots[0]?.owner.taskId &&
				owner.attemptId === snapshots[0]?.owner.attemptId,
		),
	)
	.refine(
		(snapshots) =>
			new Set(snapshots.map(({ inspection }) => inspection.source.sourceId))
				.size === snapshots.length,
	)
	.refine(
		(snapshots) =>
			new Set(snapshots.map(({ receiptId }) => receiptId)).size ===
			snapshots.length,
	)
	.refine(
		(snapshots) =>
			snapshots.reduce(
				(bytes, { inspection }) =>
					bytes + encoder.encode(inspection.text).byteLength,
				0,
			) <= SKILL_RUNTIME_LIMITS.totalBytes,
	);

/** Exact source/version selector. */
export type SkillVersion = z.infer<typeof SkillVersionSchema>;
/** Native run and optional paired task/attempt context identity. */
export type SkillOwner = z.infer<typeof SkillOwnerSchema>;
/** Selection mode and ordered exact versions. */
export type SkillPolicy = z.infer<typeof SkillPolicySchema>;
/** Retained masked content with receipt identity and separate payload digest. */
export type SkillSnapshot = z.infer<typeof SkillSnapshotSchema>;
/** Bounded snapshots belonging to one execution context. */
export type SkillContextSnapshots = z.infer<typeof SkillContextSnapshotsSchema>;
