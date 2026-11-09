import type { SkillOwner, SkillRuntimeCatalog } from "@mete/contracts";
import { contextOf } from "./skill-context.js";
import type { RunSkillState } from "./skill-state.js";

/**
 * Pure next state that retains one context's catalog, creating the context if this is its first
 * use (ADR-194). An existing catalog is never replaced, so the offered metadata stays stable.
 */
export const withCatalog = (
	skills: RunSkillState,
	owner: SkillOwner,
	roleId: string,
	catalog: SkillRuntimeCatalog,
): RunSkillState => {
	const existing = contextOf(skills, owner);
	if (existing?.catalog) return skills;
	return {
		...skills,
		contexts: existing
			? skills.contexts.map((c) => (c === existing ? { ...c, catalog } : c))
			: [...skills.contexts, { owner, roleId, snapshots: [], catalog }],
	};
};
