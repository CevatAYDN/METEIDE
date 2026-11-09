import {
	err,
	type Result,
	type SkillError,
	SkillErrorSchema,
	type SkillTrustAdapter,
} from "@mete/contracts";
import { z } from "zod";
import type { App } from "../infrastructure/app.js";

/** Only exact native implementations handed back to composition may serve skills. */
export type SkillApp = Pick<
	App,
	"registry" | "skillTrustAdapters" | "skillSourceAdapters"
>;

/** Keep the descriptor and its original implementation across asynchronous work. */
export const skillAdapter = (app: SkillApp) => {
	const resolved = app.registry.resolve<SkillTrustAdapter>("skill.trust@1");
	if (!resolved.ok) return undefined;
	const adapter = resolved.value[0];
	const impl = adapter.impl;
	return app.skillTrustAdapters.has(impl) ? { adapter, impl } : undefined;
};

/** Identity, not a registry id or declared trust label, is the authority. */
export const currentSkillAdapter = (
	app: SkillApp,
	captured: NonNullable<ReturnType<typeof skillAdapter>>,
) => {
	const current = skillAdapter(app);
	return (
		current !== undefined &&
		current.adapter === captured.adapter &&
		current.impl === captured.impl
	);
};

/** Validate the entire Result envelope, not just its successful payload. */
export const skillResult = <T>(
	schema: z.ZodType<T>,
	value: unknown,
): Result<T, SkillError> => {
	const parsed = z
		.discriminatedUnion("ok", [
			z.strictObject({ ok: z.literal(true), value: schema }),
			z.strictObject({ ok: z.literal(false), error: SkillErrorSchema }),
		])
		.safeParse(value);
	return parsed.success ? parsed.data : err({ code: "unavailable" });
};
