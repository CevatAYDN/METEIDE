import type { SkillRuntimeAdapter } from "@mete/contracts";
import { apply, type EngineState, emit, type Live } from "./run-state.js";
import type { SkillLoadHost } from "./skill-loader.js";

/**
 * Binds the coordinator to one live run and its captured drive token. Ownership ends for good
 * once the run leaves `running`, its drive changes, or it is cancelled or released.
 */
export const liveSkillHost = (
	s: EngineState,
	l: Live,
	token: object = l.token,
): SkillLoadHost => {
	const owned = () =>
		s.live.get(l.meta.id) === l &&
		l.token === token &&
		l.snapshot.value === "running" &&
		!l.all.signal.aborted;
	return {
		runtime: () => {
			const found =
				s.deps.registry.resolve<SkillRuntimeAdapter>("skill.runtime@1");
			return found.ok ? found.value[0].impl : undefined;
		},
		authority: s.skillLoads,
		skills: () => l.snapshot.context.skills,
		owned,
		commit: (skills, contextId) => {
			if (!owned() || !apply(s, l, { type: "SKILL_LOADED", skills }))
				return false;
			// Content-free refresh hint; readers re-read authoritatively (docs/07).
			emit(s, l, { type: "run.skills.updated", payload: { contextId } });
			return true;
		},
		newId: s.deps.newId,
		signal: l.all.signal,
	};
};
