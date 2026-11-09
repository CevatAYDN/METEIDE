import { z } from "zod";
import { IdSchema } from "./ids.js";
import {
	SkillErrorSchema,
	SkillSourceDescriptorSchema,
	SkillSourceInputSchema,
} from "./skill-source.js";

/** Explicit native editor lookup; a display path is never an address. */
export const DaemonSkillsEditorParamsSchema = SkillSourceInputSchema.extend({
	sessionId: IdSchema,
});
/** Original relative source only, without content, roots, permissions or caller-owned URIs. */
export const DaemonSkillsEditorResultSchema = z.discriminatedUnion("ok", [
	z.strictObject({
		ok: z.literal(true),
		value: z.strictObject({
			sessionId: IdSchema,
			source: SkillSourceDescriptorSchema,
		}),
	}),
	z.strictObject({ ok: z.literal(false), error: SkillErrorSchema }),
]);

/** Session-bound opaque source to open in the native editor. */
export type DaemonSkillsEditorParams = z.infer<
	typeof DaemonSkillsEditorParamsSchema
>;
/** Native source resolution or a precise refusal. */
export type DaemonSkillsEditorResult = z.infer<
	typeof DaemonSkillsEditorResultSchema
>;
