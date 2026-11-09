import type { SkillRuntimeCheckInput } from "@mete/contracts";
import type { RunSkillState } from "./skill-state.js";

/**
 * Every retained snapshot of every context in one run, earlier attempts included. Security
 * starts from its own complete inventory, so omitting a context here fails rather than hides it.
 */
export const skillCheckInput = (
	skills: RunSkillState,
): SkillRuntimeCheckInput => ({
	runId: skills.runId,
	snapshots: skills.contexts.flatMap(({ snapshots }) => snapshots),
});

/** True when the run carries the S2 marker and so must be validated before continuing. */
export const needsSkillCheck = (context: {
	readonly skillRuntimeVersion?: 1 | undefined;
}) => context.skillRuntimeVersion === 1;
