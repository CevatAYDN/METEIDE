import { pinOf } from "@mete/contracts";
import { activeRole, activeSeat } from "../domain/team-run.js";
import type { Seat } from "../domain/tools.js";
import { readPins } from "../infrastructure/pins-store.js";
import type { EngineState, Live } from "./run-state.js";

// A team agent's pinned model (ADR-077): read when the agent is seated, so a pin saved meanwhile
// reaches the next task while a conversation underway keeps its chain. A pins file that cannot be
// used is logged and means no pins: it never stops a run. The router, summaries and the single
// agent have no pin.

const pinFor = async (s: EngineState, templateId: string, roleId: string) => {
	const workspace = s.deps.templates?.workspace;
	if (!workspace) return undefined;
	const pins = await readPins(workspace);
	if (pins.ok) return pinOf(pins.value, templateId, roleId);
	s.deps.logger.warn({ error: pins.error }, `pins not used: ${pins.error}`);
	return undefined;
};

/** The seat of the run's active agent, with its role's pin when it has one. */
export const pinnedSeat = async (s: EngineState, l: Live): Promise<Seat> => {
	const c = l.snapshot.context;
	const seat = activeSeat(c);
	if (!c.team || !c.task) return seat;
	const { roleId, taskId } = activeRole(c);
	const key = `${taskId}/${roleId}`;
	if (l.pin?.key !== key)
		l.pin = {
			key,
			prefer: await pinFor(s, c.team.template.metadata.id, roleId),
		};
	return l.pin.prefer ? { ...seat, prefer: l.pin.prefer } : seat;
};
