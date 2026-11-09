import { createHash } from "node:crypto";
import {
	err,
	type Result,
	type RunSkillsReadInput,
	RunSkillsReadInputSchema,
	type RunSkillsReadResult,
	type SkillRuntimeAdapter,
	type SkillRuntimeError,
	SkillRuntimeInventoryResultSchema,
	type SkillSnapshot,
	skillSnapshotCanonical,
} from "@mete/contracts";
import { readRunSkills } from "../domain/skill-read.js";
import { type EngineState, loaded } from "./run-state.js";

type Read = Result<RunSkillsReadResult, SkillRuntimeError>;

const digest = ({ payloadSha256: _, ...unsigned }: SkillSnapshot) =>
	createHash("sha256").update(skillSnapshotCanonical(unsigned)).digest("hex");

const inventoryOf = async (
	s: EngineState,
	runId: string,
	signal: AbortSignal,
) => {
	const found = s.deps.registry.resolve<SkillRuntimeAdapter>("skill.runtime@1");
	if (!found.ok) return err<SkillRuntimeError>({ code: "unavailable" });
	try {
		const parsed = SkillRuntimeInventoryResultSchema.safeParse(
			await found.value[0].impl.inventory({ runId }, signal),
		);
		return parsed.success
			? parsed.data
			: err<SkillRuntimeError>({ code: "unavailable" });
	} catch {
		return err<SkillRuntimeError>({ code: "unavailable" });
	}
};

/**
 * run.skills@1.read: authenticated through security's independent inventory; current source
 * eligibility is not needed to inspect authentic history (ADR-190).
 */
export const readSkills = async (
	s: EngineState,
	input: RunSkillsReadInput,
): Promise<Read> => {
	const parsed = RunSkillsReadInputSchema.safeParse(input);
	if (!parsed.success) return err({ code: "bad_input" });
	const row = loaded(s, parsed.data.runId);
	if (
		!row.ok ||
		!row.value ||
		row.value.meta.workspaceId !== s.deps.workspaceId
	)
		return err({ code: "not_found" });
	const { context, value } = row.value.snapshot;
	const marked = context.skillRuntimeVersion === 1;
	const inventory =
		marked || context.skills
			? await inventoryOf(s, parsed.data.runId, new AbortController().signal)
			: err<SkillRuntimeError>({ code: "unavailable" });
	return readRunSkills(parsed.data, {
		skills: context.skills,
		marked,
		live: value === "queued" || value === "running" || value === "paused",
		block: context.skillBlock,
		inventory,
		digest,
	});
};
