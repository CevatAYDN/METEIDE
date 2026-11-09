import {
	type SkillRuntimeAdapter,
	type SkillRuntimeCatalog,
	SkillRuntimeCatalogResultSchema,
} from "@mete/contracts";
import { withCatalog } from "../domain/skill-catalog.js";
import { seatContext, seatOwner } from "../domain/skill-seat.js";
import { apply, type EngineState, type Live } from "./run-state.js";

const UNAVAILABLE: SkillRuntimeCatalog = {
	status: "unavailable",
	entries: [],
	diagnostics: [{ code: "unavailable" }],
};

/** Strictly parsed catalog; a malformed, refused or thrown read is an explicit unavailable notice. */
const fetchCatalog = async (
	s: EngineState,
	signal: AbortSignal,
): Promise<SkillRuntimeCatalog> => {
	const found = s.deps.registry.resolve<SkillRuntimeAdapter>("skill.runtime@1");
	if (!found.ok) return UNAVAILABLE;
	try {
		const parsed = SkillRuntimeCatalogResultSchema.safeParse(
			await found.value[0].impl.catalog(signal),
		);
		if (!parsed.success) return UNAVAILABLE;
		return parsed.data.ok
			? parsed.data.value
			: {
					status: "unavailable",
					entries: [],
					diagnostics: [parsed.data.error],
				};
	} catch {
		return UNAVAILABLE;
	}
};

/**
 * Before an auto-mode seat's first model call, fetch and retain its catalog once (ADR-194).
 * Manual/off modes, seats without a skill context and already-retained catalogs return
 * synchronously, so legacy turns gain no await. False only when the turn was lost meanwhile.
 */
export const ensureCatalog = (
	s: EngineState,
	l: Live,
	owns: () => boolean,
): boolean | Promise<boolean> => {
	const c = l.snapshot.context;
	if (c.skills?.policy.mode !== "auto" || seatContext(c)?.catalog) return true;
	const seat = seatOwner(c, s.deps.newId);
	if (!seat) return true;
	return fetchCatalog(s, l.all.signal).then((catalog) => {
		if (!owns()) return false;
		const skills = l.snapshot.context.skills;
		if (!skills) return true;
		return apply(s, l, {
			type: "SKILL_LOADED",
			skills: withCatalog(skills, seat.owner, seat.roleId, catalog),
		});
	});
};
