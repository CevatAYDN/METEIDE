import {
	err,
	type SkillApproveInput,
	type SkillDisableInput,
	type SkillError,
	type SkillMutationResult,
	SkillMutationResultSchema,
} from "@mete/contracts";
import { z } from "zod";
import {
	currentSkillAdapter,
	type SkillApp,
	skillAdapter,
} from "./daemon-skill-adapter.js";

/** Refuse before admission without suggesting that the host retire a process. */
export const skillMutationFailure = (
	code: SkillError["code"],
): SkillMutationResult => ({ admitted: false, result: err({ code }) });

const admission = z.object({ admitted: z.literal(true) });
const checkedMutation = (value: unknown): SkillMutationResult => {
	const parsed = SkillMutationResultSchema.safeParse(value);
	return parsed.success
		? parsed.data
		: {
				admitted: admission.safeParse(value).success,
				result: err({ code: "unavailable" }),
			};
};

/** Recheck the captured implementation without erasing acknowledged admission. */
export const mutateSkill = async (
	app: SkillApp,
	input:
		| { op: "approve"; value: SkillApproveInput }
		| { op: "disable"; value: SkillDisableInput },
	signal: AbortSignal,
): Promise<SkillMutationResult> => {
	if (signal.aborted) return skillMutationFailure("aborted");
	let admitted = false;
	try {
		const captured = skillAdapter(app);
		if (!captured) return skillMutationFailure("unavailable");
		const raw =
			input.op === "approve"
				? await captured.impl.approve(input.value, signal)
				: await captured.impl.disable(input.value, signal);
		const result = checkedMutation(raw);
		admitted = result.admitted;
		if (signal.aborted)
			return { admitted: result.admitted, result: err({ code: "aborted" }) };
		if (!currentSkillAdapter(app, captured))
			return {
				admitted: result.admitted,
				result: err({ code: "unavailable" }),
			};
		return result;
	} catch {
		return {
			admitted,
			result: err({ code: signal.aborted ? "aborted" : "unavailable" }),
		};
	}
};
