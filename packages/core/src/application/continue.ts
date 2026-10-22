import { type EngineError, err, ok, type Result } from "@mete/contracts";
import { handoffGoal, offerLine, startBrief } from "../domain/brief.js";
import { type EngineState, iso } from "./run-state.js";

// The start brief of a new run (docs/08, Run memory): the offer of the newest open handoff, or,
// for mete run --continue, that handoff's body once this run accepted it exactly once.
// shortcut: journal and decision notes join the brief with the knowledge layer (Phase 4).

/** What a new run opens with: its brief, the goal a continued handoff gives, the handoff taken. */
export type Opening = {
	readonly brief?: string | undefined;
	readonly goal?: string | undefined;
	readonly accepted?: string | undefined;
};

/** The brief that only offers the newest open handoff, if there is one. */
export const offerBrief = (s: EngineState): Opening => {
	const open = s.deps.handoffs?.newestOpen(s.deps.workspaceId);
	const offer = open ? offerLine(open, s.deps.now()) : undefined;
	return { brief: startBrief({ entries: [], offer }) };
};

/**
 * Takes the newest open handoff for run `runId`. Of two runs that try, one gets it; the other
 * starts without it, with the handoff's goal, so it still knows what to do.
 */
export const takeHandoff = (
	s: EngineState,
	runId: string,
): Result<Opening, EngineError> => {
	const open = s.deps.handoffs?.newestOpen(s.deps.workspaceId);
	if (!open)
		return err({ code: "not_found", message: "no open handoff to continue" });
	const goal = handoffGoal(open.body);
	if (!s.deps.handoffs?.accept(open, runId, iso(s.deps.now())))
		return ok({ ...offerBrief(s), goal });
	const entries = [{ title: `Handoff ${open.id}`, body: open.body }];
	return ok({ brief: startBrief({ entries }), goal, accepted: open.id });
};
