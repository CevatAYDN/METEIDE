import type { ToolCall } from "@mete/contracts";
import { seatOwner } from "../domain/skill-seat.js";
import {
	requestedVersion,
	SKILL_LOAD_TOOL,
	skillLoadResult,
} from "../domain/skill-tool.js";
import { apply, type EngineState, type Live } from "./run-state.js";
import { liveSkillHost } from "./skill-host.js";
import { loadSkill } from "./skill-loader.js";

/**
 * Handles a `skill_load` call in core, never through an adapter (ADR-194). The version must be
 * an exact entry of the seat's own ready catalog; origin is `model`, decided here.
 * Returns false when the call is not `skill_load`, so the ordinary tool path runs it.
 */
export const skillToolTurn = async (
	s: EngineState,
	l: Live,
	token: object,
	call: ToolCall,
): Promise<boolean> => {
	if (call.name !== SKILL_LOAD_TOOL) return false;
	const context = l.snapshot.context;
	const version = requestedVersion(context, call);
	const seat = seatOwner(context, s.deps.newId);
	const outcome =
		version && seat
			? await loadSkill(liveSkillHost(s, l, token), {
					owner: seat.owner,
					roleId: seat.roleId,
					version,
					origin: "model",
				})
			: undefined;
	if (l.token !== token) return true;
	const content = outcome?.ok
		? JSON.stringify(outcome.value)
		: JSON.stringify({
				error: outcome ? outcome.error.code : "bad_input",
				message: "Load only an exact version listed in the skill catalog.",
			});
	apply(s, l, { type: "TOOL_DONE", message: skillLoadResult(call, content) });
	return true;
};
