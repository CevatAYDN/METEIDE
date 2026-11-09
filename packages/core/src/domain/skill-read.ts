import {
	checkSkillInventoryIntegrity,
	err,
	ok,
	type Result,
	type RunSkillsReadInput,
	type RunSkillsReadResult,
	RunSkillsReadResultSchema,
	type SkillContextSummary,
	type SkillRuntimeError,
	type SkillRuntimeInventory,
	type SkillSnapshot,
	skillLoadedMetadata,
} from "@mete/contracts";
import { skillCheckInput } from "./skill-check.js";
import type { RunSkillState, SkillContextState } from "./skill-state.js";
import { skillPolicyFor } from "./skill-state.js";

type Read = Result<RunSkillsReadResult, SkillRuntimeError>;

/** A context's state for the UI: selection is not load, and history is not current authority. */
const statusOf = (
	context: SkillContextState,
	live: boolean,
): SkillContextSummary["status"] => {
	if (context.block) return "blocked";
	if (!live) return "history";
	return context.snapshots.length ? "loaded" : "selected";
};

const summaryOf = (
	skills: RunSkillState,
	context: SkillContextState,
	live: boolean,
	block: SkillRuntimeError | undefined,
): SkillContextSummary => {
	const own = context.block ?? block;
	return {
		owner: context.owner,
		roleId: context.roleId,
		policy: skillPolicyFor(skills.policy, context.roleId),
		status: own ? "blocked" : statusOf(context, live),
		loaded: context.snapshots.map(skillLoadedMetadata),
		...(own ? { block: own } : {}),
		...(context.catalog
			? {
					catalog:
						context.catalog.status === "ready"
							? { status: "ready" as const, diagnostics: [] as [] }
							: {
									status: "unavailable" as const,
									diagnostics: context.catalog.diagnostics,
								},
				}
			: {}),
	};
};

/** Inputs an authoritative read needs; `digest` must be the canonical payload SHA-256. */
export type SkillReadSource = {
	readonly skills: RunSkillState | undefined;
	readonly marked: boolean;
	readonly live: boolean;
	readonly block: SkillRuntimeError | undefined;
	readonly inventory: Result<SkillRuntimeInventory, SkillRuntimeError>;
	readonly digest: (snapshot: SkillSnapshot) => string;
};

/** Authentic evidence first: a corrupt, missing or mismatched record is never empty. */
const authentic = (
	runId: string,
	source: SkillReadSource,
): Result<RunSkillState, SkillRuntimeError> => {
	const { skills } = source;
	if (!skills || skills.runId !== runId)
		return err({ code: "integrity_failed" });
	if (!source.inventory.ok) return source.inventory;
	const integrity = checkSkillInventoryIntegrity(
		source.inventory.value,
		skillCheckInput(skills),
		source.digest,
	);
	return integrity.ok ? ok(skills) : integrity;
};

/**
 * Pure authoritative projection (ADR-190). Genuine legacy runs read as `legacy`; an S2 run whose
 * state, inventory or integrity is missing or corrupt is an error, never empty evidence.
 */
export const readRunSkills = (
	input: RunSkillsReadInput,
	source: SkillReadSource,
): Read => {
	if (!source.marked && !source.skills)
		return ok({ kind: "legacy", runId: input.runId });
	const checked = authentic(input.runId, source);
	if (!checked.ok) return checked;
	const skills = checked.value;
	const { block } = source;
	const contexts = skills.contexts.map((context) =>
		summaryOf(skills, context, source.live, block),
	);
	const result = input.contextId
		? detailOf(input, skills, contexts, block)
		: {
				kind: "summary",
				runId: input.runId,
				policy: skills.policy,
				contexts,
				...(block ? { block } : {}),
			};
	if (!result) return err({ code: "not_found" });
	const parsed = RunSkillsReadResultSchema.safeParse(result);
	return parsed.success ? ok(parsed.data) : err({ code: "integrity_failed" });
};

const detailOf = (
	input: RunSkillsReadInput,
	skills: RunSkillState,
	contexts: SkillContextSummary[],
	block: SkillRuntimeError | undefined,
) => {
	const index = skills.contexts.findIndex(
		({ owner }) => owner.contextId === input.contextId,
	);
	const context = skills.contexts[index];
	const summary = contexts[index];
	if (!context || !summary) return undefined;
	return {
		kind: "context",
		runId: input.runId,
		context: summary,
		snapshots: context.snapshots,
		...(block ? { block } : {}),
	};
};
