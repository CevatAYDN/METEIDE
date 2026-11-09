import { z } from "zod";
import { IdSchema } from "./ids.js";
import { SkillErrorSchema, SkillSourceInputSchema } from "./skill-source.js";
import {
	SkillApproveInputSchema,
	SkillDisableInputSchema,
	SkillMutationResultSchema,
	SkillPreviewSchema,
	SkillTrustListSchema,
} from "./skill-trust.js";

const session = { sessionId: IdSchema };
const failed = z.strictObject({
	ok: z.literal(false),
	error: SkillErrorSchema,
});

/** Initial inventory request; the daemon returns its once-created instance UUID. */
export const DaemonSkillsListParamsSchema = z.strictObject({});
/** The daemon checks this instance UUID before preparing in its trust adapter. */
export const DaemonSkillsPrepareParamsSchema =
	SkillSourceInputSchema.extend(session);
/** Reject a replaced daemon's callback before entering the composition guard. */
export const DaemonSkillsApproveParamsSchema =
	SkillApproveInputSchema.extend(session);
/** Revision and daemon identity are both checked before mutation admission. */
export const DaemonSkillsDisableParamsSchema =
	SkillDisableInputSchema.extend(session);

/** Skill failures stay typed; no EngineError conversion or fabricated inventory. */
export const DaemonSkillsListResultSchema = z.discriminatedUnion("ok", [
	z.strictObject({
		ok: z.literal(true),
		value: SkillTrustListSchema.safeExtend(session),
	}),
	failed,
]);
/** Safe preparation failures never become an empty or successful preview. */
export const DaemonSkillsPrepareResultSchema = z.discriminatedUnion("ok", [
	z.strictObject({
		ok: z.literal(true),
		value: SkillPreviewSchema.extend(session),
	}),
	failed,
]);
/** Retire only the captured daemon when the adapter acknowledges admission. */
export const DaemonSkillsApproveResultSchema = SkillMutationResultSchema;
/** Post-admission failures retain the exact same authoritative result envelope. */
export const DaemonSkillsDisableResultSchema = SkillMutationResultSchema;

/** Empty inventory request. */
export type DaemonSkillsListParams = z.infer<
	typeof DaemonSkillsListParamsSchema
>;
/** Safe inventory result with daemon identity on success. */
export type DaemonSkillsListResult = z.infer<
	typeof DaemonSkillsListResultSchema
>;
/** Session-bound source review request. */
export type DaemonSkillsPrepareParams = z.infer<
	typeof DaemonSkillsPrepareParamsSchema
>;
/** Safe preview result with daemon identity on success. */
export type DaemonSkillsPrepareResult = z.infer<
	typeof DaemonSkillsPrepareResultSchema
>;
/** Session-bound preview-consumption request. */
export type DaemonSkillsApproveParams = z.infer<
	typeof DaemonSkillsApproveParamsSchema
>;
/** Authoritative approval admission and outcome. */
export type DaemonSkillsApproveResult = z.infer<
	typeof DaemonSkillsApproveResultSchema
>;
/** Session-bound revision-checked disable request. */
export type DaemonSkillsDisableParams = z.infer<
	typeof DaemonSkillsDisableParamsSchema
>;
/** Authoritative disable admission and outcome. */
export type DaemonSkillsDisableResult = z.infer<
	typeof DaemonSkillsDisableResultSchema
>;
