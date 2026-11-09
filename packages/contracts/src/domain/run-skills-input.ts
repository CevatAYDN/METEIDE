import { z } from "zod";
import { RunStartSchema } from "./engine.js";
import { SkillPolicySchema } from "./skill-runtime.js";
import { LocalIdSchema } from "./template.js";

/** One role's ordered exact selections; loaded-template membership is checked by core. */
export const RunSkillRoleSchema = z
	.strictObject({
		roleId: LocalIdSchema,
		selected: SkillPolicySchema.shape.selected,
	})
	.refine(
		({ selected }) =>
			new Set(selected.map(({ sourceId }) => sourceId)).size ===
			selected.length,
	);

/** Run mode with independent role selections, never a run-wide selection budget. */
export const RunSkillPolicySchema = z
	.strictObject({
		mode: SkillPolicySchema.shape.mode,
		roles: z.array(RunSkillRoleSchema).default([]),
	})
	.refine(
		({ roles }) =>
			new Set(roles.map(({ roleId }) => roleId)).size === roles.length,
	)
	.refine(
		({ mode, roles }) =>
			mode !== "off" || roles.every(({ selected }) => selected.length === 0),
	);

/** Versioned run start with pre-router refusal, not native skill admission. */
export const RunSkillsStartInputSchema = RunStartSchema.safeExtend({
	skills: RunSkillPolicySchema.default(() => ({
		mode: "auto" as const,
		roles: [],
	})),
})
	.refine(
		({ templateId, skills }) =>
			templateId !== undefined ||
			skills.roles.every(({ selected }) => selected.length === 0),
		{
			message: "explicit role selections require a decided template",
			path: ["skills", "roles"],
		},
	)
	.refine(
		({ templateId, skills }) =>
			templateId !== null ||
			skills.roles.every(({ roleId }) => roleId === "assistant"),
		{
			message: "single-agent skills allow only the assistant role",
			path: ["skills", "roles"],
		},
	);

/** One role's validated exact selections. */
export type RunSkillRole = z.infer<typeof RunSkillRoleSchema>;
/** Validated run selection mode and independent roles. */
export type RunSkillPolicy = z.infer<typeof RunSkillPolicySchema>;
/** Caller input for run.skills@1.start, including optional defaults. */
export type RunSkillsStartInput = z.input<typeof RunSkillsStartInputSchema>;
