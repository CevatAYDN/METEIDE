import { z } from "zod";
import { SKILL_RUNTIME_LIMITS } from "../defaults.js";
import type { Result } from "./result.js";
import { SkillVersionSchema } from "./skill-runtime.js";
import {
	type SkillRuntimeError,
	SkillRuntimeErrorSchema,
} from "./skill-runtime-catalog.js";

/** Exact explicit versions for one prospective context, without native authority claims. */
export const SkillSelectionInputSchema = z
	.strictObject({
		selected: z.array(SkillVersionSchema).max(SKILL_RUNTIME_LIMITS.perContext),
	})
	.refine(
		({ selected }) =>
			new Set(selected.map(({ sourceId }) => sourceId)).size ===
			selected.length,
	);

/** Preflight confirms only the current check; no contents, receipt or reusable lease. */
export const SkillSelectionResultSchema = z.discriminatedUnion("ok", [
	z.strictObject({ ok: z.literal(true), value: z.null() }),
	z.strictObject({ ok: z.literal(false), error: SkillRuntimeErrorSchema }),
]);

/** Ordered and bounded pre-admission selection. */
export type SkillSelectionInput = z.infer<typeof SkillSelectionInputSchema>;
/** Current preflight result, never runtime authorization. */
export type SkillSelectionResult = z.infer<typeof SkillSelectionResultSchema>;

/** skill.selection@1 performs local read-only validation before a run is created (ADR-191). */
export interface SkillSelectionAdapter {
	check(
		input: SkillSelectionInput,
		signal: AbortSignal,
	): Promise<Result<null, SkillRuntimeError>>;
}
