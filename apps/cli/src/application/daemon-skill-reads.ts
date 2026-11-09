import {
	err,
	ok,
	type SkillPreview,
	SkillPreviewSchema,
	type SkillSourceInput,
	type SkillTrustAdapter,
	type SkillTrustList,
	SkillTrustListSchema,
} from "@mete/contracts";
import type { z } from "zod";
import {
	currentSkillAdapter,
	type SkillApp,
	skillAdapter,
	skillResult,
} from "./daemon-skill-adapter.js";

const readSkill = async <T>(
	app: SkillApp,
	signal: AbortSignal,
	read: {
		schema: z.ZodType<T>;
		invoke: (impl: SkillTrustAdapter) => Promise<unknown>;
	},
) => {
	if (signal.aborted) return err({ code: "aborted" as const });
	try {
		const captured = skillAdapter(app);
		if (!captured) return err({ code: "unavailable" as const });
		const raw = await read.invoke(captured.impl);
		if (signal.aborted) return err({ code: "aborted" as const });
		if (!currentSkillAdapter(app, captured))
			return err({ code: "unavailable" as const });
		return skillResult(read.schema, raw);
	} catch {
		return err({
			code: signal.aborted ? ("aborted" as const) : ("unavailable" as const),
		});
	}
};

/** Read-only inventory with this connection's once-created session identity. */
export const listSkills = async (
	app: SkillApp,
	sessionId: string,
	signal: AbortSignal,
) => {
	const result = await readSkill<SkillTrustList>(app, signal, {
		schema: SkillTrustListSchema,
		invoke: (impl) => impl.status(signal),
	});
	return result.ok ? ok({ ...result.value, sessionId }) : result;
};

/** Prepare in this process without closing its run admission gate. */
export const prepareSkill = async (
	app: SkillApp,
	sessionId: string,
	input: SkillSourceInput,
	signal: AbortSignal,
) => {
	const result = await readSkill<SkillPreview>(app, signal, {
		schema: SkillPreviewSchema,
		invoke: (impl) => impl.prepare(input, signal),
	});
	return result.ok ? ok({ ...result.value, sessionId }) : result;
};
