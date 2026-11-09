import type { RunContext } from "../domain/run-types.js";
import { seatContext, seatOwner } from "../domain/skill-seat.js";
import { skillPolicyFor } from "../domain/skill-state.js";
import type { EngineState, Live } from "./run-state.js";
import { blockRunSkills } from "./skill-guard.js";
import { liveSkillHost } from "./skill-host.js";
import { loadSkill } from "./skill-loader.js";

/** Load the selected prefix before budgeting or dispatching a native working context. */
export const ensureExplicitSkills = (
	s: EngineState,
	l: Live,
	token: object,
	context: RunContext,
): boolean | Promise<boolean> => {
	if (!context.skills || context.skills.policy.mode === "off") return true;
	const seat = seatOwner(context, s.deps.newId);
	if (!seat) return true;
	const selected = skillPolicyFor(context.skills.policy, seat.roleId).selected;
	const count =
		seatContext(context)?.snapshots.filter((s) => s.origin === "explicit")
			.length ?? 0;
	if (count === selected.length) return true;
	const host = liveSkillHost(s, l, token);
	// Retain the native context identity before security can issue a receipt (ADR-190).
	if (!seatContext(context)) {
		const skills = {
			...context.skills,
			contexts: [
				...context.skills.contexts,
				{
					...seat,
					snapshots: [],
				},
			],
		};
		if (!host.commit(skills, seat.owner.contextId)) return false;
	}
	return (async () => {
		for (const version of selected.slice(count)) {
			const loaded = await loadSkill(host, {
				...seat,
				version,
				origin: "explicit",
			});
			if (!host.owned()) return false;
			if (!loaded.ok) {
				blockRunSkills(s, l, loaded.error);
				return false;
			}
		}
		return true;
	})();
};
